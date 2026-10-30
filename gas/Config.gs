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

function getMeeting_() {
  var date = props_().getProperty('MEETING_DATE') || '';
  var time = props_().getProperty('MEETING_TIME') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) time = date ? '09:00' : '';
  return { meetingDate: date, meetingTime: time };
}

function config() {
  var meeting = getMeeting_();
  return {
    today: todayFolderDate_(),
    maxAttachBytes: MAX_ATTACH_BYTES_,
    allowedRecipientDomain: ALLOWED_RECIPIENT_DOMAIN_,
    officers: getOfficers_(),
    meetingDate: meeting.meetingDate,
    meetingTime: meeting.meetingTime,
  };
}

function extractFolderId_(input) {
  var text = String(input || '').trim();
  var folder = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folder) return folder[1];
  var query = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (query) return query[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  return '';
}

function setConfig(payload, req) {
  var changes = [];
  if (payload.rootFolder) {
    var folderId = extractFolderId_(payload.rootFolder);
    if (!folderId) fail_('INVALID_INPUT', 'Drive 폴더 주소 또는 폴더 ID를 입력해 주세요.');
    try {
      DriveApp.getFolderById(folderId).getName();
    } catch (ignore) {
      fail_('NOT_FOUND', '해당 폴더를 열 수 없습니다. 배포 계정이 폴더를 볼 수 있는지 확인해 주세요.');
    }
    props_().setProperty('ROOT_FOLDER_ID', folderId);
    setSetting_('루트폴더ID', '', 'Script Property ROOT_FOLDER_ID가 우선입니다.');
    changes.push('자료폴더');
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
    meetingFolder = ensureDateFolder_(payload.meetingDate);
    props_().setProperty('MEETING_DATE', meetingFolder.dateKey);
    props_().setProperty('MEETING_TIME', meetingTime);
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
  var meeting = getMeeting_();
  return {
    officers: getOfficers_(),
    meetingDate: meeting.meetingDate,
    meetingTime: meeting.meetingTime,
    meetingAuto: getMeetingAuto_(),
    meetingFolder: meetingFolder,
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
