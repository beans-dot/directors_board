var APP_VERSION_ = '0.22.1';
var UUID_RE_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var WRITE_ACTIONS_ = { register: 1, log: 1, adminLogin: 1, setConfig: 1, requestTreeRefresh: 1, setChangeNotice: 1 };
var FILE_SLOTS_ = 3;
var FILE_SLOT_KEY_ = 'fileSlots';
var FILE_WAIT_MS_ = 200000;

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === 'file') return serveFileGet_(params);
  return out_({ ok: true, data: { service: 'bojik', version: APP_VERSION_ } });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (ignore) {
    return out_(err_('INVALID_INPUT', '요청 형식 오류'));
  }
  var routes = {
    config: config,
    boot: boot,
    pulse: pulse,
    tree: tree,
    file: file,
    fileMeta: fileMeta,
    register: register,
    log: log,
    adminLogin: adminLogin,
    setConfig: setConfig,
    requestTreeRefresh: requestTreeRefresh,
    setChangeNotice: setChangeNotice,
    logs: logs,
    stage: stage,
    send: send,
    sendStatus: sendStatus,
    materialZip: materialZip,
  };
  var fn = routes[req.action];
  if (!fn) return out_(err_('INVALID_ACTION', '알 수 없는 요청'));
  var locked = false;
  var lock = null;
  var fileTicket = null;
  try {
    assertDeviceId_(req.deviceId);
    if (req.action === 'setConfig' || req.action === 'logs' || req.action === 'requestTreeRefresh' || req.action === 'setChangeNotice') {
      verifyAdminToken_(req.adminToken, req.deviceId);
    }
    var payload = req.payload || {};
    if (req.action === 'file') fileTicket = claimFileSlot_();
    else if (WRITE_ACTIONS_[req.action]) {
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
      locked = true;
    }
    return out_({ ok: true, data: fn(payload, req) });
  } catch (x) {
    return out_(publicError_(x));
  } finally {
    if (fileTicket) releaseFileSlot_(fileTicket);
    if (locked && lock) lock.releaseLock();
  }
}

function boot(payload, req) {
  return { config: config(), tree: tree(payload || {}, req) };
}

function serveFileGet_(params) {
  var fileTicket = null;
  try {
    assertDeviceId_(params.deviceId);
    fileTicket = claimFileSlot_();
    var payload = readFilePayload_({ fileId: params.fileId });
    var meta = {
      fileId: payload.fileId,
      name: payload.name,
      mimeType: 'application/pdf',
      modifiedTime: payload.modifiedTime,
      md5Checksum: payload.md5Checksum,
      size: payload.size,
    };
    return ContentService.createTextOutput('BOJIKPDF1\n' + JSON.stringify(meta) + '\n' + payload.base64).setMimeType(
      ContentService.MimeType.TEXT,
    );
  } catch (x) {
    return out_(publicError_(x));
  } finally {
    if (fileTicket) releaseFileSlot_(fileTicket);
  }
}

function out_(body) {
  body.serverTime = isoKst_();
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function publicError_(x) {
  if (x && x.code) return err_(x.code, x.message, x.extra);
  var detail = String((x && x.message) || x || '');
  if (/permission|authorization|권한/i.test(detail)) {
    return err_('INTERNAL', '메일 보내기 권한이 없습니다. 운영자가 Apps Script를 다시 승인해야 합니다.');
  }
  if (/잠금 시간초과|Lock timeout/i.test(detail)) {
    return err_('BUSY', '다른 요청을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.');
  }
  return err_('INTERNAL', detail ? detail.slice(0, 240) : '서버 오류');
}

function withScriptLock_(fn, waitMs) {
  var lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function readFileSlots_(cache) {
  var raw = cache.get(FILE_SLOT_KEY_);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return parsed && parsed.length ? parsed : [];
  } catch (ignore) {
    return [];
  }
}

function claimFileSlot_() {
  var token = Utilities.getUuid();
  var started = Date.now();
  while (Date.now() - started < FILE_WAIT_MS_) {
    var lock = null;
    var mine = false;
    try {
      lock = LockService.getScriptLock();
      lock.waitLock(8000);
      var cache = CacheService.getScriptCache();
      var now = Date.now();
      var slots = readFileSlots_(cache).filter(function (slot) {
        return now - Number(slot.at || 0) < 240000;
      });
      if (slots.length < FILE_SLOTS_) {
        slots.push({ token: token, at: now });
        cache.put(FILE_SLOT_KEY_, JSON.stringify(slots), 600);
        mine = true;
      }
    } catch (ignore) {
    } finally {
      if (lock) {
        try {
          lock.releaseLock();
        } catch (ignoreRelease) {}
      }
    }
    if (mine) return token;
    Utilities.sleep(700);
  }
  fail_('BUSY', '다른 파일을 받는 중입니다. 잠시 후 다시 시도해 주세요.');
}

function releaseFileSlot_(token) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
  } catch (ignore) {
    return;
  }
  try {
    var cache = CacheService.getScriptCache();
    var slots = readFileSlots_(cache).filter(function (slot) {
      return slot.token !== token;
    });
    if (slots.length) cache.put(FILE_SLOT_KEY_, JSON.stringify(slots), 600);
    else cache.remove(FILE_SLOT_KEY_);
  } finally {
    lock.releaseLock();
  }
}

function err_(code, message, extra) {
  var error = { code: code, message: message };
  if (extra) {
    Object.keys(extra).forEach(function (key) {
      error[key] = extra[key];
    });
  }
  return { ok: false, error: error };
}

function fail_(code, message, extra) {
  var error = new Error(message);
  error.code = code;
  error.extra = extra || null;
  throw error;
}

function assertDeviceId_(deviceId) {
  if (!UUID_RE_.test(String(deviceId || ''))) fail_('INVALID_INPUT', '기기 정보가 올바르지 않습니다.');
}

function isoKst_(date) {
  var when = date || new Date();
  return Utilities.formatDate(when, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss'+09:00'");
}

function stampKst_(date) {
  return Utilities.formatDate(date || new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function todayFolderDate_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yy.MM.dd.');
}
