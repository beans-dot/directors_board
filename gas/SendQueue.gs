var SEND_DRAIN_HANDLER_ = 'drainSendQueueTrigger';
var SEND_WORKER_LEASE_MS_ = 300000;

function ensureSendQueueFolder_() {
  var existing = props_().getProperty('SEND_QUEUE_FOLDER_ID');
  if (existing) {
    try {
      return DriveApp.getFolderById(existing);
    } catch (ignore) {}
  }
  var rootId = getRootFolderId_();
  var parent = rootId ? DriveApp.getFolderById(rootId).getParents().next() : DriveApp.getRootFolder();
  var created = parent.createFolder('_메일대기');
  props_().setProperty('SEND_QUEUE_FOLDER_ID', created.getId());
  return created;
}

function sendQueueFolder_() {
  var existing = props_().getProperty('SEND_QUEUE_FOLDER_ID');
  if (!existing) return ensureSendQueueFolder_();
  return DriveApp.getFolderById(existing);
}

function enqueueSendJob_(payload, req) {
  var folder = withScriptLock_(function () {
    return ensureSendQueueFolder_();
  }, 15000);
  var id = Utilities.getUuid();
  var createdAt = Date.now();
  var body = {
    to: payload.to,
    subject: payload.subject,
    htmlBody: payload.htmlBody,
    textBody: payload.textBody,
    mode: payload.mode === 'link' ? 'link' : 'attach',
    attachments: payload.attachments || [],
    folderDate: payload.folderDate,
    fileCount: payload.fileCount || 0,
    totalBytes: payload.totalBytes || 0,
    usePack: !!payload.usePack,
    folderId: String(payload.folderId || ''),
    sendId: String(payload.sendId || ''),
    replacements: payload.replacements || [],
  };
  folder.createFile(Utilities.newBlob(JSON.stringify(body), 'application/json', id + '.body.json'));
  var status = {
    id: id,
    deviceId: req.deviceId,
    createdAt: createdAt,
    state: 'pending',
    mode: body.mode,
    claimedAt: 0,
    claim: '',
    code: '',
    message: '',
    at: '',
  };
  folder.createFile(Utilities.newBlob(JSON.stringify(status), 'application/json', id + '.status.json'));
  return status;
}

function statusFile_(id) {
  var folderId = props_().getProperty('SEND_QUEUE_FOLDER_ID');
  if (!folderId) return null;
  var files = DriveApp.getFolderById(folderId).getFilesByName(id + '.status.json');
  return files.hasNext() ? files.next() : null;
}

function readSendStatus_(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  var file = statusFile_(id);
  if (!file) return null;
  try {
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (ignore) {
    return null;
  }
}

function saveStatus_(file, data) {
  file.setContent(JSON.stringify(data));
}

function listQueueMetas_() {
  var folderId = props_().getProperty('SEND_QUEUE_FOLDER_ID');
  if (!folderId) return [];
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var metas = [];
  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().indexOf('.status.json') < 0) continue;
    try {
      metas.push({ file: file, data: JSON.parse(file.getBlob().getDataAsString()) });
    } catch (ignore) {}
  }
  metas.sort(function (a, b) {
    return Number(a.data.createdAt || 0) - Number(b.data.createdAt || 0);
  });
  return metas;
}

function countAhead_(status) {
  var metas = listQueueMetas_();
  var ahead = 0;
  for (var i = 0; i < metas.length; i++) {
    var data = metas[i].data;
    if (!data || data.id === status.id) continue;
    if (Number(data.createdAt || 0) >= Number(status.createdAt || 0)) continue;
    if (data.state === 'pending' || data.state === 'sending') ahead++;
  }
  return ahead;
}

function sendQueueHasPending_() {
  var metas = listQueueMetas_();
  var now = Date.now();
  for (var i = 0; i < metas.length; i++) {
    var data = metas[i].data;
    if (!data) continue;
    if (data.state === 'pending') return true;
    if (data.state === 'sending' && now - Number(data.claimedAt || 0) > SEND_WORKER_LEASE_MS_) return true;
  }
  return false;
}

function claimOldest_() {
  return withScriptLock_(function () {
    var metas = listQueueMetas_();
    var now = Date.now();
    for (var i = 0; i < metas.length; i++) {
      var item = metas[i];
      var data = item.data;
      if (!data) continue;
      var stale = data.state === 'sending' && now - Number(data.claimedAt || 0) > SEND_WORKER_LEASE_MS_;
      if (data.state !== 'pending' && !stale) continue;
      var folder = sendQueueFolder_();
      var bodies = folder.getFilesByName(data.id + '.body.json');
      if (!bodies.hasNext()) {
        data.state = 'error';
        data.code = 'INTERNAL';
        data.message = '발송 파일을 찾지 못했습니다.';
        saveStatus_(item.file, data);
        continue;
      }
      data.state = 'sending';
      data.claimedAt = now;
      data.claim = Utilities.getUuid();
      saveStatus_(item.file, data);
      return { id: data.id, claim: data.claim, data: data };
    }
    return null;
  }, 20000);
}

function markIfClaim_(claimed, patch) {
  withScriptLock_(function () {
    var current = readSendStatus_(claimed.id);
    var file = statusFile_(claimed.id);
    if (!current || !file || current.claim !== claimed.claim) return;
    Object.keys(patch).forEach(function (key) {
      current[key] = patch[key];
    });
    saveStatus_(file, current);
  }, 20000);
}

function runClaimedJob_(claimed) {
  touchSender_();
  var folder = sendQueueFolder_();
  var bodies = folder.getFilesByName(claimed.id + '.body.json');
  if (!bodies.hasNext()) {
    markIfClaim_(claimed, { state: 'error', code: 'INTERNAL', message: '발송 파일을 찾지 못했습니다.' });
    return;
  }
  var bodyFile = bodies.next();
  var payload;
  try {
    payload = JSON.parse(bodyFile.getBlob().getDataAsString());
  } catch (error) {
    markIfClaim_(claimed, { state: 'error', code: 'INTERNAL', message: '발송 내용을 읽지 못했습니다.' });
    bodyFile.setTrashed(true);
    return;
  }
  try {
    var result = sendNow_(payload, { deviceId: claimed.data.deviceId });
    markIfClaim_(claimed, { state: 'done', at: result.at, mode: result.mode, code: '', message: '' });
    bodyFile.setTrashed(true);
  } catch (error) {
    markIfClaim_(claimed, {
      state: 'error',
      code: (error && error.code) || 'INTERNAL',
      message: String((error && error.message) || error || '메일을 보내지 못했습니다.').slice(0, 240),
    });
    bodyFile.setTrashed(true);
  }
}

function tryBecomeSender_() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (ignore) {
    return '';
  }
  try {
    var until = Number(props_().getProperty('SEND_WORKER_UNTIL') || '0');
    if (until > Date.now()) return '';
    var token = Utilities.getUuid();
    props_().setProperty('SEND_WORKER_TOKEN', token);
    props_().setProperty('SEND_WORKER_UNTIL', String(Date.now() + SEND_WORKER_LEASE_MS_));
    return token;
  } finally {
    lock.releaseLock();
  }
}

function touchSender_() {
  props_().setProperty('SEND_WORKER_UNTIL', String(Date.now() + SEND_WORKER_LEASE_MS_));
}

function releaseSender_(token) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(10000);
    locked = true;
  } catch (ignore) {
    return;
  }
  try {
    if (props_().getProperty('SEND_WORKER_TOKEN') !== token) return;
    props_().deleteProperty('SEND_WORKER_TOKEN');
    props_().deleteProperty('SEND_WORKER_UNTIL');
  } finally {
    if (locked) lock.releaseLock();
  }
}

function drainSendJobs_(budgetMs, stopAfterId) {
  var start = Date.now();
  var limit = budgetMs || 240000;
  while (Date.now() - start < limit) {
    var job = claimOldest_();
    if (!job) return;
    runClaimedJob_(job);
    if (stopAfterId && job.id === stopAfterId) return;
  }
}

function ensureSendDrainTrigger_() {
  withScriptLock_(function () {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === SEND_DRAIN_HANDLER_) return;
    }
    ScriptApp.newTrigger(SEND_DRAIN_HANDLER_).timeBased().everyMinutes(1).create();
  }, 15000);
}

function removeSendDrainTrigger_() {
  withScriptLock_(function () {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === SEND_DRAIN_HANDLER_) ScriptApp.deleteTrigger(triggers[i]);
    }
  }, 15000);
}

function drainSendQueueTrigger() {
  var worker = tryBecomeSender_();
  if (!worker) return;
  try {
    drainSendJobs_(240000, '');
  } finally {
    releaseSender_(worker);
    if (!sendQueueHasPending_()) {
      try {
        removeSendDrainTrigger_();
      } catch (ignore) {}
    }
  }
}

function sendJobResult_(id) {
  var status = readSendStatus_(id);
  if (!status) fail_('INTERNAL', '발송 접수를 확인하지 못했습니다.');
  if (status.state === 'done') return { sent: true, mode: status.mode, at: status.at, jobId: id };
  if (status.state === 'error') fail_(status.code || 'INTERNAL', status.message || '메일을 보내지 못했습니다.');
  return { queued: true, jobId: id, ahead: countAhead_(status), mode: status.mode };
}

function sendStatus(payload) {
  var id = String((payload && payload.jobId) || '');
  if (!id) fail_('INVALID_INPUT', '발송 번호가 없습니다.');
  var status = readSendStatus_(id);
  if (!status) fail_('NOT_FOUND', '발송 접수를 찾을 수 없습니다.');
  if (status.state === 'pending' || status.state === 'sending') {
    var worker = tryBecomeSender_();
    if (worker) {
      try {
        drainSendJobs_(240000, id);
      } finally {
        releaseSender_(worker);
        if (!sendQueueHasPending_()) {
          try {
            removeSendDrainTrigger_();
          } catch (ignore) {}
        }
      }
    }
  }
  return sendJobResult_(id);
}

function cleanupSendQueue_() {
  var folderId = props_().getProperty('SEND_QUEUE_FOLDER_ID');
  if (!folderId) return;
  var cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.getDateCreated().getTime() < cutoff) file.setTrashed(true);
  }
}
