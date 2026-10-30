var APP_VERSION_ = '0.12.0';
var UUID_RE_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var WRITE_ACTIONS_ = { register: 1, log: 1, adminLogin: 1, setConfig: 1 };
var SYNC_ACTIONS_ = { tree: 1, file: 1 };
var SYNC_QUEUE_KEY_ = 'syncQueue';
var SYNC_BUSY_KEY_ = 'syncBusy';
var SYNC_WAIT_MS_ = 200000;

function doGet() {
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
    tree: tree,
    file: file,
    register: register,
    log: log,
    adminLogin: adminLogin,
    setConfig: setConfig,
    logs: logs,
    stage: stage,
    send: send,
    sendStatus: sendStatus,
  };
  var fn = routes[req.action];
  if (!fn) return out_(err_('INVALID_ACTION', '알 수 없는 요청'));
  var locked = false;
  var lock = null;
  try {
    assertDeviceId_(req.deviceId);
    if (req.action === 'setConfig' || req.action === 'logs') verifyAdminToken_(req.adminToken, req.deviceId);
    var payload = req.payload || {};
    var ticket = null;
    if (SYNC_ACTIONS_[req.action]) ticket = claimSyncTicket_();
    else if (WRITE_ACTIONS_[req.action]) {
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
      locked = true;
    }
    return out_({ ok: true, data: fn(payload, req) });
  } catch (x) {
    return out_(publicError_(x));
  } finally {
    if (ticket) releaseSyncTicket_(ticket);
    if (locked && lock) lock.releaseLock();
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

function readSyncQueue_() {
  var raw = CacheService.getScriptCache().get(SYNC_QUEUE_KEY_);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return parsed && parsed.length ? parsed : [];
  } catch (ignore) {
    return [];
  }
}

function writeSyncQueue_(queue) {
  var cache = CacheService.getScriptCache();
  if (!queue.length) cache.remove(SYNC_QUEUE_KEY_);
  else cache.put(SYNC_QUEUE_KEY_, JSON.stringify(queue), 600);
}

function claimSyncTicket_() {
  var token = Utilities.getUuid();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var queue = readSyncQueue_();
    queue.push({ token: token, at: Date.now() });
    writeSyncQueue_(queue);
  } finally {
    lock.releaseLock();
  }
  var started = Date.now();
  while (Date.now() - started < SYNC_WAIT_MS_) {
    var mine = false;
    try {
      lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        var current = readSyncQueue_();
        var cache = CacheService.getScriptCache();
        var busy = cache.get(SYNC_BUSY_KEY_);
        var head = current[0];
        if (head && head.token !== token && !busy && Date.now() - Number(head.at || 0) > 45000) {
          current.shift();
          writeSyncQueue_(current);
          head = current[0];
        }
        if (head && head.token === token && !busy) {
          cache.put(SYNC_BUSY_KEY_, token, 300);
          mine = true;
        }
      } finally {
        lock.releaseLock();
      }
    } catch (ignore) {}
    if (mine) return token;
    Utilities.sleep(1200);
  }
  releaseSyncTicket_(token);
  fail_('BUSY', '다른 동기화를 처리하고 있습니다. 잠시 후 다시 시도해 주세요.');
}

function releaseSyncTicket_(token) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (ignore) {
    return;
  }
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(SYNC_BUSY_KEY_) === token) cache.remove(SYNC_BUSY_KEY_);
    writeSyncQueue_(readSyncQueue_().filter(function (item) { return item.token !== token; }));
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
