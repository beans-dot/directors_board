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
  if (mode === 'attach' && total > MAX_ATTACH_BYTES_) {
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
    attachments: payload.attachments || [],
    folderDate: payload.folderDate,
    fileCount: payload.fileCount || 0,
    totalBytes: total,
  };
  var job;
  try {
    job = enqueueSendJob_(normalized, req);
  } catch (ignoreEnqueue) {
    var inlineWorker = tryBecomeSender_();
    if (!inlineWorker) fail_('BUSY', '다른 메일을 보내는 중입니다. 잠시 후 다시 시도해 주세요.');
    try {
      return sendNow_(normalized, req);
    } finally {
      releaseSender_(inlineWorker);
    }
  }
  try {
    ensureSendDrainTrigger_();
  } catch (ignore) {}
  var worker = tryBecomeSender_();
  if (worker) {
    try {
      drainSendJobs_(240000, job.id);
    } finally {
      releaseSender_(worker);
      if (!sendQueueHasPending_()) {
        try {
          removeSendDrainTrigger_();
        } catch (ignoreRemove) {}
      }
    }
  }
  return sendJobResult_(job.id);
}

function sendNow_(payload, req) {
  var to = String(payload.to || '');
  var mode = payload.mode === 'link' ? 'link' : 'attach';
  var attachments = payload.attachments || [];
  var total = Number(payload.totalBytes || 0);
  var options = {
    htmlBody: sanitizeHtml_(payload.htmlBody),
    name: getMailFromName_(),
  };
  var alias = getMailFromAlias_();
  if (alias) options.from = alias;
  try {
    if (mode === 'attach') {
      options.attachments = attachments.map(function (item) {
        var name = attachmentName_(item.name);
        return Utilities.newBlob(Utilities.base64Decode(item.base64), attachmentMime_(name), name);
      });
    }
    GmailApp.sendEmail(to, String(payload.subject || '보직회의 자료'), String(payload.textBody || ''), options);
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
    var rootName = '';
    if (rootId) {
      try {
        rootName = DriveApp.getFolderById(rootId).getName();
      } catch (ignore) {
        rootName = '';
      }
    }
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
        senderEmail: sender,
        aliases: aliases,
        mailFromName: getMailFromName_(),
        mailFromAlias: getMailFromAlias_(),
        officers: getOfficers_(),
        meetingDate: meeting.meetingDate,
        meetingTime: meeting.meetingTime,
        meetingAuto: getMeetingAuto_(),
        dateFolders: listDateFolders_(),
      },
    };
  }
  fail_('INVALID_INPUT', '조회 종류가 올바르지 않습니다.');
}
