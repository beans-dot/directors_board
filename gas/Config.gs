var ALLOWED_RECIPIENT_DOMAIN_ = 'yeonsung.ac.kr';
var MAX_ATTACH_BYTES_ = 26214400;
var MAX_PDF_BYTES_ = 30 * 1024 * 1024;

function props_() {
  return PropertiesService.getScriptProperties();
}

function requireScript_(key) {
  var value = props_().getProperty(key);
  if (!value) fail_('CONFIG_MISSING', '서버 설정이 없습니다. 운영자에게 문의해 주세요.');
  return value;
}

function getRootFolderId_() {
  var fromProp = props_().getProperty('ROOT_FOLDER_ID');
  if (fromProp) return fromProp;
  return getSetting_('루트폴더ID') || '';
}

function getResultKeepDays_() {
  var n = parseInt(getSetting_('결과보관일수') || '7', 10);
  return isNaN(n) || n < 1 ? 7 : n;
}

function getMailFromName_() {
  return props_().getProperty('MAIL_FROM_NAME') || '보직회의 지원 시스템';
}

function getMailFromAlias_() {
  return props_().getProperty('MAIL_FROM_ALIAS') || '';
}

var USAGE_TIP_MAX_CHARS_ = 100;
var USAGE_TIP_MAX_COUNT_ = 20;

function readUsageTips_() {
  var raw = props_().getProperty('USAGE_TIPS') || '[]';
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (ignore) {
    return [];
  }
  return normalizeUsageTips_(parsed, true);
}

function normalizeUsageTips_(input, silent) {
  if (!input || !input.length) return [];
  if (!Array.isArray(input)) {
    if (silent) return [];
    fail_('INVALID_INPUT', '사용 Tip 형식이 올바르지 않습니다.');
  }
  var tips = [];
  for (var i = 0; i < input.length; i++) {
    var text = String(input[i] == null ? '' : input[i])
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    if (text.length > USAGE_TIP_MAX_CHARS_) text = text.slice(0, USAGE_TIP_MAX_CHARS_);
    tips.push(text);
  }
  if (tips.length > USAGE_TIP_MAX_COUNT_) {
    if (silent) return tips.slice(0, USAGE_TIP_MAX_COUNT_);
    fail_('INVALID_INPUT', '사용 Tip은 20개까지 저장할 수 있습니다.');
  }
  return tips;
}

function getMeeting_() {
  try {
    rollMeetingIfPast_();
  } catch (ignoreRoll) {}
  var date = props_().getProperty('MEETING_DATE') || '';
  var time = props_().getProperty('MEETING_TIME') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) time = date ? '09:00' : '';
  return { meetingDate: date, meetingTime: time };
}

function pulse() {
  return {
    treeRefreshAt: props_().getProperty('TREE_REFRESH_AT') || '',
    changeNotices: publicChangeNotices_(readChangeNotices_()),
  };
}

function requestTreeRefresh(payload, req) {
  var at = isoKst_();
  props_().setProperty('TREE_REFRESH_AT', at);
  clearTreeCache_();
  appendAccess_({ deviceId: req.deviceId, action: '자료새로고침', target: '접속 중인 화면' });
  return { treeRefreshAt: at };
}

function config() {
  var meeting = getMeeting_();
  try {
    var due = packDueMs_(meeting);
    var stamp = due ? String(due) : 'none';
    if (CacheService.getScriptCache().get('pack:trigger') !== stamp) {
      withScriptLock_(function () {
        syncPackTrigger_(meeting);
      }, 8000);
    }
  } catch (ignorePack) {}
  return {
    today: todayFolderDate_(),
    maxAttachBytes: MAX_ATTACH_BYTES_,
    allowedRecipientDomain: ALLOWED_RECIPIENT_DOMAIN_,
    officers: getOfficers_(),
    meetingDate: meeting.meetingDate,
    meetingTime: meeting.meetingTime,
    changeNotices: publicChangeNotices_(readChangeNotices_()),
    usageTips: readUsageTips_(),
  };
}

function readChangeNotices_() {
  var raw = props_().getProperty('CHANGE_NOTICES') || '[]';
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (ignore) {
    return [];
  }
  if (!parsed || !parsed.length) return [];
  var cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  var notices = [];
  parsed.forEach(function (item) {
    if (!item || !item.fileId || !item.path) return;
    var at = Date.parse(item.at || '');
    if (isNaN(at) || at < cutoff) return;
    notices.push({ fileId: String(item.fileId), path: String(item.path), at: item.at });
  });
  return notices;
}

function publicChangeNotices_(notices) {
  return notices.map(function (item) {
    return { fileId: item.fileId, path: item.path };
  });
}

function writeChangeNotices_(notices) {
  while (notices.length && JSON.stringify(notices).length > 8000) notices.shift();
  props_().setProperty('CHANGE_NOTICES', JSON.stringify(notices));
}

function setChangeNotice(payload, req) {
  var fileId = String(payload.fileId || '');
  var path = String(payload.path || '').trim();
  var enabled = !(payload.enabled === false || payload.enabled === 0 || payload.enabled === '0');
  if (!fileId || !path || path.length > 400) fail_('INVALID_INPUT', '파일을 지정해 주세요.');
  var rootId = getRootFolderId_();
  if (!rootId) fail_('CONFIG_MISSING', '자료 폴더가 설정되지 않았습니다.');
  if (!isUnderRoot_(fileId, rootId)) fail_('NOT_FOUND', '파일을 찾을 수 없습니다.');
  var meta;
  try {
    meta = Drive.Files.get(fileId, { fields: 'id,mimeType', supportsAllDrives: true });
  } catch (ignore) {
    fail_('NOT_FOUND', '파일을 찾을 수 없습니다.');
  }
  if (meta.mimeType !== 'application/pdf') fail_('NOT_PDF', 'PDF만 변경 알림을 켤 수 있습니다.');
  var notices = readChangeNotices_().filter(function (item) {
    return item.fileId !== fileId && item.path !== path;
  });
  if (enabled) notices.push({ fileId: fileId, path: path, at: isoKst_() });
  writeChangeNotices_(notices);
  appendAccess_({
    deviceId: req.deviceId,
    action: enabled ? '변경알림' : '변경알림해제',
    target: path,
  });
  return { changeNotices: publicChangeNotices_(readChangeNotices_()) };
}

function extractFolderId_(input) {
  var text = String(input || '').trim();
  try {
    text = decodeURIComponent(text);
  } catch (ignore) {}
  var folder = text.match(/\/folders\/([^/?#]+)/);
  if (folder) return folder[1];
  var file = text.match(/\/file\/d\/([^/?#]+)/);
  if (file) return file[1];
  var query = text.match(/[?&]id=([^&#]+)/);
  if (query) return query[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  return '';
}

function openDriveFolder_(input) {
  var folderId = extractFolderId_(input);
  if (!folderId) fail_('INVALID_INPUT', 'Drive 폴더 주소 또는 폴더 ID를 입력해 주세요.');
  var current = folderId;
  var guard = 0;
  while (guard < 5) {
    var meta;
    try {
      meta = Drive.Files.get(current, {
        fields: 'id,name,mimeType,shortcutDetails',
        supportsAllDrives: true,
      });
    } catch (ignore) {
      fail_('NOT_FOUND', '해당 폴더를 열 수 없습니다. 배포 계정이 폴더를 볼 수 있는지 확인해 주세요.');
    }
    var target = meta.shortcutDetails && meta.shortcutDetails.targetId;
    if (meta.mimeType === 'application/vnd.google-apps.shortcut' && target && target !== meta.id) {
      current = target;
      guard++;
      continue;
    }
    if (meta.mimeType !== 'application/vnd.google-apps.folder') {
      fail_('INVALID_INPUT', '폴더 주소가 아닙니다. 폴더를 연 주소 전체를 넣어 주세요.');
    }
    return { id: meta.id, name: meta.name || '' };
  }
  fail_('INVALID_INPUT', '폴더 바로가기가 너무 깁니다. 실제 폴더 주소를 넣어 주세요.');
}

function folderLabel_(folderId) {
  if (!folderId) return '';
  try {
    return DriveApp.getFolderById(folderId).getName();
  } catch (ignore) {
    return '';
  }
}

function folderContains_(ancestorId, folderId) {
  if (!ancestorId || !folderId || ancestorId === folderId) return false;
  try {
    return isUnderRoot_(folderId, ancestorId);
  } catch (ignore) {
    return false;
  }
}

function setConfig(payload, req) {
  var changes = [];
  if (payload.rootFolder) {
    var root = openDriveFolder_(payload.rootFolder);
    var currentResult = props_().getProperty('RESULT_FOLDER_ID') || '';
    var currentQueue = props_().getProperty('SEND_QUEUE_FOLDER_ID') || '';
    var currentPack = props_().getProperty('PACK_FOLDER_ID') || '';
    if (currentResult && root.id === currentResult) fail_('INVALID_INPUT', '자료 폴더와 발송 결과 폴더는 서로 달라야 합니다.');
    if (currentQueue && root.id === currentQueue) fail_('INVALID_INPUT', '자료 폴더와 메일 대기 폴더는 서로 달라야 합니다.');
    if (currentPack && root.id === currentPack) fail_('INVALID_INPUT', '자료 폴더와 자료 압축 폴더는 서로 달라야 합니다.');
    props_().setProperty('ROOT_FOLDER_ID', root.id);
    setSetting_('루트폴더ID', '', 'Script Property ROOT_FOLDER_ID가 우선입니다.');
    clearTreeCache_();
    changes.push('자료폴더');
  }
  if (payload.resultFolder) {
    var result = openDriveFolder_(payload.resultFolder);
    if (result.id === getRootFolderId_()) fail_('INVALID_INPUT', '자료 폴더와 다른 폴더를 지정해 주세요.');
    var queueNow = props_().getProperty('SEND_QUEUE_FOLDER_ID') || '';
    var packNow = props_().getProperty('PACK_FOLDER_ID') || '';
    if (result.id === queueNow || folderContains_(result.id, queueNow)) {
      fail_('INVALID_INPUT', '발송 결과 폴더와 메일 대기 폴더는 서로 달라야 합니다.');
    }
    if (result.id === packNow || folderContains_(result.id, packNow)) {
      fail_('INVALID_INPUT', '발송 결과 폴더와 자료 압축 폴더는 서로 달라야 합니다.');
    }
    props_().setProperty('RESULT_FOLDER_ID', result.id);
    changes.push('발송결과폴더');
  }
  if (payload.queueFolder) {
    var queue = openDriveFolder_(payload.queueFolder);
    var rootNow = getRootFolderId_();
    var resultNow = props_().getProperty('RESULT_FOLDER_ID') || '';
    var packForQueue = props_().getProperty('PACK_FOLDER_ID') || '';
    if (queue.id === rootNow || queue.id === resultNow || queue.id === packForQueue) {
      fail_('INVALID_INPUT', '메일 대기 폴더는 자료 폴더, 발송 결과 폴더, 자료 압축 폴더와 다른 폴더여야 합니다.');
    }
    if (folderContains_(resultNow, queue.id)) {
      fail_('INVALID_INPUT', '메일 대기 폴더는 발송 결과 폴더 밖에 지정해 주세요. 그 안에 두면 보관 기간이 지난 뒤 지워질 수 있습니다.');
    }
    props_().setProperty('SEND_QUEUE_FOLDER_ID', queue.id);
    changes.push('메일대기폴더');
  }
  if (payload.packFolder) {
    var pack = openDriveFolder_(payload.packFolder);
    var rootForPack = getRootFolderId_();
    var resultForPack = props_().getProperty('RESULT_FOLDER_ID') || '';
    var queueForPack = props_().getProperty('SEND_QUEUE_FOLDER_ID') || '';
    if (pack.id === rootForPack || pack.id === resultForPack || pack.id === queueForPack) {
      fail_('INVALID_INPUT', '자료 압축 폴더는 자료 폴더, 발송 결과 폴더, 메일 대기 폴더와 다른 폴더여야 합니다.');
    }
    if (folderContains_(resultForPack, pack.id)) {
      fail_('INVALID_INPUT', '자료 압축 폴더는 발송 결과 폴더 밖에 지정해 주세요. 그 안에 두면 보관 기간이 지난 뒤 지워질 수 있습니다.');
    }
    props_().setProperty('PACK_FOLDER_ID', pack.id);
    changes.push('자료압축폴더');
  }
  if (payload.mailFromName != null) {
    var name = String(payload.mailFromName).trim().slice(0, 80);
    if (!name) fail_('INVALID_INPUT', '표시 이름을 입력해 주세요.');
    props_().setProperty('MAIL_FROM_NAME', name);
    changes.push('표시이름');
  }
  if (payload.officers != null) {
    var officers = normalizeOfficers_(payload.officers);
    var encoded = JSON.stringify(officers);
    if (encoded.length > 8000) fail_('INVALID_INPUT', '보직자 목록이 너무 깁니다.');
    props_().setProperty('OFFICERS', encoded);
    changes.push('보직자 ' + officers.length + '명');
  }
  var meetingFolder = null;
  if (payload.clearMeeting) {
    props_().deleteProperty('MEETING_DATE');
    props_().deleteProperty('MEETING_TIME');
    changes.push('회의일시 삭제');
  } else if (payload.meetingDate) {
    var meetingTime = String(payload.meetingTime || '09:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(meetingTime)) fail_('INVALID_INPUT', '회의 시간은 HH:mm 형식이어야 합니다.');
    meetingFolder = folderMetaFromKey_(payload.meetingDate);
    props_().setProperty('MEETING_DATE', meetingFolder.dateKey);
    props_().setProperty('MEETING_TIME', meetingTime);
    clearTreeCache_();
    changes.push('회의일시 ' + meetingFolder.folderDate + ' ' + meetingTime);
  }
  if (payload.meetingAuto != null) {
    var autoOn = payload.meetingAuto === true || payload.meetingAuto === '1' || payload.meetingAuto === 1;
    if (autoOn) props_().setProperty('MEETING_AUTO', '1');
    else props_().deleteProperty('MEETING_AUTO');
    try {
      syncMeetingAutoTrigger_();
    } catch (ignoreTrigger) {
      if (autoOn) props_().deleteProperty('MEETING_AUTO');
      fail_('CONFIG_MISSING', '자동생성 예약을 만들지 못했습니다. Apps Script에서 setup을 한 번 실행해 주세요.');
    }
    changes.push(autoOn ? '자동생성 켬' : '자동생성 끔');
  }
  if (payload.usageTips != null) {
    var usageTips = normalizeUsageTips_(payload.usageTips, false);
    props_().setProperty('USAGE_TIPS', JSON.stringify(usageTips));
    changes.push('사용Tip ' + usageTips.length + '개');
  }
  if (payload.mailFromAlias != null) {
    var alias = String(payload.mailFromAlias).trim();
    if (alias) {
      var aliases = [];
      try {
        aliases = GmailApp.getAliases();
      } catch (ignoreAlias) {
        aliases = [];
      }
      if (aliases.indexOf(alias) < 0) fail_('INVALID_INPUT', '배포 계정에 등록된 별칭만 보낼 수 있습니다.');
    }
    props_().setProperty('MAIL_FROM_ALIAS', alias);
    changes.push('별칭');
  }
  if (!changes.length) fail_('INVALID_INPUT', '바꿀 설정이 없습니다.');
  appendAccess_({ deviceId: req.deviceId, action: '설정변경', target: changes.join(', ') });
  try {
    CacheService.getScriptCache().remove('pack:trigger');
  } catch (ignorePackCache) {}
  try {
    syncPackTrigger_({
      meetingDate: props_().getProperty('MEETING_DATE') || '',
      meetingTime: props_().getProperty('MEETING_TIME') || '',
    });
  } catch (ignorePack) {}
  var meeting = getMeeting_();
  var rootIdNow = getRootFolderId_();
  var resultIdNow = props_().getProperty('RESULT_FOLDER_ID') || '';
  var queueIdNow = props_().getProperty('SEND_QUEUE_FOLDER_ID') || '';
  var packIdNow = props_().getProperty('PACK_FOLDER_ID') || '';
  return {
    officers: getOfficers_(),
    meetingDate: meeting.meetingDate,
    meetingTime: meeting.meetingTime,
    meetingAuto: getMeetingAuto_(),
    meetingFolder: meetingFolder,
    rootFolderSet: !!rootIdNow,
    rootFolderName: folderLabel_(rootIdNow),
    resultFolderSet: !!resultIdNow,
    resultFolderName: folderLabel_(resultIdNow),
    queueFolderSet: !!queueIdNow,
    queueFolderName: folderLabel_(queueIdNow),
    packFolderSet: !!packIdNow,
    packFolderName: folderLabel_(packIdNow),
    usageTips: readUsageTips_(),
  };
}

function defaultOfficers_() {
  return [
    { id: 'a1000001-0000-4000-8000-000000000001', position: '총장', name: '', email: '' },
    { id: 'a1000002-0000-4000-8000-000000000002', position: '산학부총장', name: '', email: '' },
    { id: 'a1000003-0000-4000-8000-000000000003', position: '기획처장', name: '', email: '' },
    { id: 'a1000004-0000-4000-8000-000000000004', position: '교무처장', name: '', email: '' },
    { id: 'a1000005-0000-4000-8000-000000000005', position: '입학홍보처장', name: '', email: '' },
    { id: 'a1000006-0000-4000-8000-000000000006', position: '학생취업처장', name: '', email: '' },
    { id: 'a1000007-0000-4000-8000-000000000007', position: '행정지원처장', name: '', email: '' },
  ];
}

function getOfficers_() {
  var raw = props_().getProperty('OFFICERS');
  if (!raw) {
    var seeded = defaultOfficers_();
    props_().setProperty('OFFICERS', JSON.stringify(seeded));
    return seeded;
  }
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (ignore) {
    return [];
  }
}

function normalizeOfficers_(input) {
  if (!Array.isArray(input)) fail_('INVALID_INPUT', '보직자 목록 형식이 올바르지 않습니다.');
  if (input.length > 30) fail_('INVALID_INPUT', '보직자는 30명까지 등록할 수 있습니다.');
  var seenEmail = {};
  var seenId = {};
  return input.map(function (row) {
    row = row || {};
    var position = String(row.position || '').trim();
    var name = String(row.name || '').trim();
    var email = String(row.email || '').trim().toLowerCase();
    if (!position || position.length > 40) fail_('INVALID_INPUT', '직위를 40자 이내로 입력해 주세요.');
    if (name.length > 40) fail_('INVALID_INPUT', '이름은 40자 이내로 입력해 주세요.');
    if (email && !/^[^\s@]+@yeonsung\.ac\.kr$/i.test(email)) {
      fail_('INVALID_INPUT', '연성대학교 메일(@yeonsung.ac.kr)만 등록할 수 있습니다.');
    }
    var id = String(row.id || '');
    if (!UUID_RE_.test(id) || seenId[id]) id = Utilities.getUuid();
    seenId[id] = 1;
    if (email) {
      if (seenEmail[email]) fail_('INVALID_INPUT', '같은 메일 주소가 두 번 있습니다.');
      seenEmail[email] = 1;
    }
    return { id: id, position: position, name: name, email: email };
  });
}
