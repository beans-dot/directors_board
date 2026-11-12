function isAllowedRecipient_(raw) {
  var value = String(raw || '').trim();
  if (!value || value.indexOf(',') >= 0 || value.indexOf(';') >= 0 || /\s/.test(value)) return false;
  return /^[^\s@]+@yeonsung\.ac\.kr$/i.test(value);
}

function assertRecipient_(raw) {
  if (!isAllowedRecipient_(raw)) fail_('EMAIL_NOT_ALLOWED', '연성대학교 메일(@yeonsung.ac.kr)만 받을 수 있습니다.');
  return String(raw).trim();
}

function sanitizeHtml_(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function lockedAppendSendLog_(entry) {
  try {
    withScriptLock_(function () {
      appendSendLog_(entry);
    }, 15000);
  } catch (ignore) {}
}

function sendMemoKey_(sendId) {
  return 'sent:' + sendId;
}

function readSendMemo_(sendId) {
  if (!UUID_RE_.test(String(sendId || ''))) return null;
  try {
    var raw = CacheService.getScriptCache().get(sendMemoKey_(sendId));
    return raw ? JSON.parse(raw) : null;
  } catch (ignore) {
    return null;
  }
}

function writeSendMemo_(sendId, data) {
  if (!UUID_RE_.test(String(sendId || ''))) return;
  try {
    CacheService.getScriptCache().put(sendMemoKey_(sendId), JSON.stringify(data), 21600);
  } catch (ignore) {}
}

function clearInflightSend_(sendId) {
  var memo = readSendMemo_(sendId);
  if (!memo || memo.state !== 'inflight') return;
  try {
    CacheService.getScriptCache().remove(sendMemoKey_(sendId));
  } catch (ignore) {}
}

function sentMemoResult_(memo) {
  return { sent: true, mode: memo.mode, at: memo.at };
}

function claimOrReplaySend_(sendId) {
  if (!UUID_RE_.test(String(sendId || ''))) return null;
  var deadline = Date.now() + 200000;
  while (true) {
    var claimed = withScriptLock_(function () {
      var memo = readSendMemo_(sendId);
      if (memo && memo.state === 'done') return { replay: sentMemoResult_(memo) };
      if (memo && memo.state === 'queued' && memo.jobId) return { jobId: memo.jobId };
      if (memo && memo.state === 'inflight' && Date.now() - Number(memo.at || 0) < 360000) return { wait: true };
      writeSendMemo_(sendId, { state: 'inflight', at: Date.now() });
      return null;
    }, 15000);
    if (!claimed) return null;
    if (claimed.replay) return claimed.replay;
    if (claimed.jobId) {
      try {
        var result = sendJobResult_(claimed.jobId);
        if (result && result.sent) return rememberSent_(sendId, result);
        return result;
      } catch (error) {
        try {
          CacheService.getScriptCache().remove(sendMemoKey_(sendId));
        } catch (ignore) {}
        throw error;
      }
    }
    if (Date.now() >= deadline) return { queued: true, ahead: 0 };
    Utilities.sleep(2000);
  }
}

function rememberSent_(sendId, result) {
  writeSendMemo_(sendId, { state: 'done', mode: result.mode || 'attach', at: result.at || isoKst_() });
  return result;
}

function rememberQueued_(sendId, job) {
  writeSendMemo_(sendId, { state: 'queued', jobId: job.id, at: Date.now() });
}

function finishQueued_(sendId, job) {
  rememberQueued_(sendId, job);
  var result = sendJobResult_(job.id);
  if (result && result.sent) return rememberSent_(sendId, result);
  return result;
}

function send(payload, req) {
  var to = '';
  try {
    to = assertRecipient_(payload.to);
  } catch (error) {
    lockedAppendSendLog_({
      deviceId: req.deviceId,
      folderDate: payload.folderDate,
      to: payload.to,
      fileCount: payload.fileCount || 0,
      bytes: payload.totalBytes || 0,
      mode: payload.mode,
      result: '실패',
      error: error.message,
    });
    throw error;
  }
  var mode = payload.mode === 'link' ? 'link' : 'attach';
  var total = Number(payload.totalBytes || 0);
  if (!payload.usePack && mode === 'attach' && total > MAX_ATTACH_BYTES_) {
    lockedAppendSendLog_({
      deviceId: req.deviceId,
      folderDate: payload.folderDate,
      to: to,
      fileCount: payload.fileCount || 0,
      bytes: total,
      mode: '첨부',
      result: '실패',
      error: 'TOO_LARGE',
    });
    fail_('TOO_LARGE', '첨부 용량이 25MB를 넘습니다.');
  }
  var normalized = {
    to: to,
    subject: payload.subject,
    htmlBody: payload.htmlBody,
    textBody: payload.textBody,
    mode: mode,
    attachments: payload.usePack ? [] : payload.attachments || [],
    folderDate: payload.folderDate,
    fileCount: payload.fileCount || 0,
    totalBytes: total,
    usePack: !!payload.usePack,
    folderId: String(payload.folderId || ''),
    sendId: String(payload.sendId || ''),
    replacements: payload.usePack ? payload.replacements || [] : [],
  };
  var sendId = String(payload.sendId || '');
  var replay = claimOrReplaySend_(sendId);
  if (replay) return replay;
  var job;
  try {
    job = enqueueSendJob_(normalized, req);
    rememberQueued_(sendId, job);
    try {
      ensureSendDrainTrigger_();
    } catch (ignore) {}
    return { queued: true, jobId: job.id, ahead: 0, mode: normalized.mode };
  } catch (error) {
    clearInflightSend_(sendId);
    if (error && error.code) throw error;
    fail_('BUSY', '메일을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

function sendNow_(payload, req) {
  var to = String(payload.to || '');
  var resolved = payload.usePack ? resolvePackMail_(payload, req) : null;
  var mode = resolved ? resolved.mode : payload.mode === 'link' ? 'link' : 'attach';
  var attachments = payload.attachments || [];
  var total = resolved ? resolved.totalBytes : Number(payload.totalBytes || 0);
  var htmlBody = resolved ? resolved.htmlBody : payload.htmlBody;
  var textBody = resolved ? resolved.textBody : payload.textBody;
  var options = {
    htmlBody: sanitizeHtml_(htmlBody),
    name: getMailFromName_(),
  };
  var alias = getMailFromAlias_();
  if (alias) options.from = alias;
  try {
    if (mode === 'attach') {
      if (resolved && resolved.blob) options.attachments = [resolved.blob];
      else {
        options.attachments = attachments.map(function (item) {
          var name = attachmentName_(item.name);
          return Utilities.newBlob(Utilities.base64Decode(item.base64), attachmentMime_(name), name);
        });
      }
    }
    GmailApp.sendEmail(to, String(payload.subject || '보직회의 자료'), String(textBody || ''), options);
    lockedAppendSendLog_({
      deviceId: req.deviceId,
      folderDate: payload.folderDate,
      to: to,
      fileCount: payload.fileCount || attachments.length,
      bytes: total,
      mode: mode === 'attach' ? '첨부' : '링크',
      result: '성공',
      error: '',
    });
    return { sent: true, mode: mode, at: isoKst_() };
  } catch (error) {
    if (error && error.code) throw error;
    var message = String((error && error.message) || error);
    lockedAppendSendLog_({
      deviceId: req.deviceId,
      folderDate: payload.folderDate,
      to: to,
      fileCount: payload.fileCount || 0,
      bytes: total,
      mode: mode === 'attach' ? '첨부' : '링크',
      result: '실패',
      error: message,
    });
    if (/quota|daily|한도/i.test(message)) fail_('QUOTA_EXCEEDED', '오늘 보낼 수 있는 메일 수를 모두 사용했습니다.');
    if (/size|limit|25/i.test(message)) fail_('TOO_LARGE', '첨부 용량이 25MB를 넘습니다.');
    fail_('INTERNAL', message ? '메일을 보내지 못했습니다. ' + message.slice(0, 180) : '메일을 보내지 못했습니다.');
  }
}

function attachmentName_(name) {
  var cleaned = String(name || 'memo.pdf').replace(/[\\/:*?"<>|\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\.(pdf|zip)$/i.test(cleaned)) cleaned += '.pdf';
  return cleaned.slice(0, 180) || 'memo.pdf';
}

function attachmentMime_(name) {
  return /\.zip$/i.test(String(name || '')) ? 'application/zip' : 'application/pdf';
}

function register(payload, req) {
  var name = String(payload.name || '').trim();
  var position = String(payload.position || '').trim();
  if (!name || !position) fail_('INVALID_INPUT', '이름과 보직을 입력해 주세요.');
  var result = upsertDevice_({
    deviceId: req.deviceId,
    name: name,
    position: position,
    userAgent: String(payload.userAgent || '').slice(0, 300),
  });
  return { registered: true, isAdmin: !!(result && result.admin) };
}

function log(payload, req) {
  var events = payload.events || [];
  if (!events.length) return { written: 0 };
  events.forEach(function (event) {
    appendAccess_({
      deviceId: req.deviceId,
      action: event.action,
      folderDate: event.folderDate,
      target: event.target,
    });
  });
  return { written: events.length };
}

function logs(payload) {
  var type = payload.type;
  var limit = Math.min(Number(payload.limit || 500), 1000);
  if (type === 'devices') {
    var devices = readRows_(TAB_DEVICES_).slice(-limit).map(function (row) {
      return {
        deviceId: row.deviceId,
        name: row['이름'],
        position: row['보직'],
        firstSeen: row['첫접속'],
        lastSeen: row['마지막접속'],
        browser: row['브라우저'],
        admin: row['admin(Y/N)'],
      };
    });
    return { rows: devices };
  }
  if (type === 'access' || type === 'send') {
    var rows = readRows_(type === 'access' ? TAB_ACCESS_ : TAB_SEND_);
    rows = rows.filter(function (row) {
      var at = String(row['시각'] || '');
      if (payload.from && at < payload.from) return false;
      if (payload.to && at.slice(0, 10) > payload.to) return false;
      return true;
    });
    rows.reverse();
    if (type === 'access') {
      return {
        rows: rows.slice(0, limit).map(function (row) {
          return {
            deviceId: row.deviceId,
            name: row['이름'],
            folderDate: row['날짜폴더'],
            action: row['동작'],
            target: row['대상'],
            at: row['시각'],
          };
        }),
      };
    }
    return {
      rows: rows.slice(0, limit).map(function (row) {
        return {
          deviceId: row.deviceId,
          name: row['이름'],
          folderDate: row['날짜폴더'],
          to: row['받는주소'],
          fileCount: row['첨부수'],
          bytes: row['용량(bytes)'],
          mode: row['방식(첨부/링크)'],
          result: row['결과(성공/실패)'],
          error: row['오류'],
          at: row['시각'],
        };
      }),
    };
  }
  if (type === 'settings') {
    var rootId = getRootFolderId_();
    var rootName = folderLabel_(rootId);
    var resultId = props_().getProperty('RESULT_FOLDER_ID') || '';
    var resultName = folderLabel_(resultId);
    var queueId = props_().getProperty('SEND_QUEUE_FOLDER_ID') || '';
    var queueName = folderLabel_(queueId);
    var packId = props_().getProperty('PACK_FOLDER_ID') || '';
    var packName = folderLabel_(packId);
    var aliases = [];
    try {
      aliases = GmailApp.getAliases();
    } catch (ignoreAliases) {
      aliases = [];
    }
    var sender = '';
    try {
      sender = Session.getEffectiveUser().getEmail();
    } catch (ignoreUser) {
      sender = '';
    }
    var meeting = getMeeting_();
    return {
      rows: [],
      settings: {
        rootFolderSet: !!rootId,
        rootFolderName: rootName,
        resultFolderSet: !!resultId,
        resultFolderName: resultName,
        queueFolderSet: !!queueId,
        queueFolderName: queueName,
        packFolderSet: !!packId,
        packFolderName: packName,
        senderEmail: sender,
        aliases: aliases,
        mailFromName: getMailFromName_(),
        mailFromAlias: getMailFromAlias_(),
        officers: getOfficers_(),
        meetingDate: meeting.meetingDate,
        meetingTime: meeting.meetingTime,
        meetingAuto: getMeetingAuto_(),
        dateFolders: listDateFolders_(),
        usageTips: readUsageTips_(),
      },
    };
  }
  fail_('INVALID_INPUT', '조회 종류가 올바르지 않습니다.');
}
