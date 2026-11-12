/** 날짜 폴더 PDF를 미리 압축해 두고, 메모가 있는 파일만 바꿔 넣습니다. */

function sendArchivePath_(filePath) {
  var parts = String(filePath || '').split('/').filter(function (part) { return part; });
  var fileName = parts.length ? parts[parts.length - 1] : 'file.pdf';
  if (parts.length >= 3 && parts[1] === '별첨') return ['별첨'].concat(parts.slice(2)).join('/');
  if (parts.length >= 3 && parts[1] === '규정') return ['규정'].concat(parts.slice(2)).join('/');
  if (parts.length >= 3 && parts[1] === '본문') return parts.slice(2).join('/') || fileName;
  if (parts.length >= 3) return parts.slice(1).join('/');
  return fileName;
}

function uniqueArchivePaths_(paths) {
  var seen = {};
  return paths.map(function (path) {
    var count = seen[path] || 0;
    seen[path] = count + 1;
    if (count === 0) return path;
    var slash = path.lastIndexOf('/');
    var dot = path.lastIndexOf('.');
    var insertAt = dot > slash ? dot : path.length;
    return path.slice(0, insertAt) + ' (' + (count + 1) + ')' + path.slice(insertAt);
  });
}

function archiveFileName_(folderDate) {
  var date = String(folderDate || '').replace(/\.+$/, '') || folderDate || '자료';
  return '보직회의_' + date + '.zip';
}

function zipBaseName_(zipPath) {
  var slash = String(zipPath).lastIndexOf('/');
  return slash >= 0 ? zipPath.slice(slash + 1) : zipPath;
}

function ensurePackFolder_() {
  var existing = props_().getProperty('PACK_FOLDER_ID');
  if (existing) {
    try {
      return DriveApp.getFolderById(existing);
    } catch (ignore) {}
  }
  return withScriptLock_(function () {
    existing = props_().getProperty('PACK_FOLDER_ID');
    if (existing) {
      try {
        return DriveApp.getFolderById(existing);
      } catch (ignore) {}
    }
    var rootId = getRootFolderId_();
    var parent = rootId ? DriveApp.getFolderById(rootId).getParents().next() : DriveApp.getRootFolder();
    var created = parent.createFolder('_자료압축');
    props_().setProperty('PACK_FOLDER_ID', created.getId());
    return created;
  }, 15000);
}

function packFolder_() {
  var existing = props_().getProperty('PACK_FOLDER_ID');
  if (!existing) return ensurePackFolder_();
  try {
    return DriveApp.getFolderById(existing);
  } catch (ignore) {
    return ensurePackFolder_();
  }
}

function findDateFolder_(folderId) {
  var data = loadTree_();
  var folders = (data && data.folders) || [];
  for (var i = 0; i < folders.length; i++) {
    if (folders[i].id === folderId) return folders[i];
  }
  return null;
}

function collectPackNodes_(node, out) {
  if (node.kind === 'file' && node.isPdf) {
    out.push({
      fileId: node.id,
      path: node.path,
      size: Number(node.size || 0),
      md5: node.md5Checksum || '',
      modifiedTime: node.modifiedTime || '',
    });
    return;
  }
  (node.children || []).forEach(function (child) {
    collectPackNodes_(child, out);
  });
}

function packFingerprint_(entries) {
  var lines = entries.map(function (entry) {
    return [entry.fileId, entry.md5, entry.modifiedTime, String(entry.size), entry.zipPath].join('\t');
  }).join('\n');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, lines, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(digest);
}

function packSnapshot_(folderId) {
  var folder = findDateFolder_(folderId);
  if (!folder) fail_('NOT_FOUND', '날짜 폴더를 찾지 못했습니다.');
  var raw = [];
  collectPackNodes_(folder, raw);
  if (!raw.length) fail_('INVALID_INPUT', '보낼 PDF가 없습니다.');
  var paths = uniqueArchivePaths_(raw.map(function (entry) { return sendArchivePath_(entry.path); }));
  var entries = raw.map(function (entry, index) {
    var zipPath = paths[index];
    return {
      fileId: entry.fileId,
      path: entry.path,
      zipPath: zipPath,
      name: zipBaseName_(zipPath),
      size: entry.size,
      md5: entry.md5,
      modifiedTime: entry.modifiedTime,
    };
  });
  return {
    folderId: folderId,
    folderDate: folder.folderDate,
    name: archiveFileName_(folder.folderDate),
    entries: entries,
    fingerprint: packFingerprint_(entries),
  };
}

function publicEntries_(entries) {
  return entries.map(function (entry) {
    return { path: entry.path, zipPath: entry.zipPath, name: entry.name, size: entry.size };
  });
}

function readManifest_(folderId) {
  var files = packFolder_().getFilesByName(folderId + '.json');
  if (!files.hasNext()) return null;
  try {
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (ignore) {
    return null;
  }
}

function writeManifest_(manifest) {
  var folder = packFolder_();
  var name = manifest.folderId + '.json';
  var files = folder.getFilesByName(name);
  var previous = null;
  if (files.hasNext()) {
    var existing = files.next();
    try {
      previous = JSON.parse(existing.getBlob().getDataAsString());
    } catch (ignore) {}
    existing.setContent(JSON.stringify(manifest));
  } else {
    folder.createFile(Utilities.newBlob(JSON.stringify(manifest), 'application/json', name));
  }
  if (previous && previous.fileId && previous.fileId !== manifest.fileId) {
    try {
      DriveApp.getFileById(previous.fileId).setTrashed(true);
    } catch (ignore) {}
  }
}

function freshPack_(folderId, fingerprint) {
  var manifest = readManifest_(folderId);
  if (!manifest || manifest.fingerprint !== fingerprint || !manifest.fileId) return null;
  try {
    if (DriveApp.getFileById(manifest.fileId).isTrashed()) return null;
    return manifest;
  } catch (ignore) {
    return null;
  }
}

function packReady_(manifest, snapshot) {
  try {
    shareView_(DriveApp.getFileById(manifest.fileId), '');
  } catch (ignore) {}
  return {
    ready: true,
    building: false,
    fileId: manifest.fileId,
    name: manifest.name,
    size: Number(manifest.size || 0),
    url: manifest.url,
    fingerprint: manifest.fingerprint,
    folderDate: snapshot.folderDate,
    entries: publicEntries_(snapshot.entries),
  };
}

function buildPack_(snapshot) {
  try {
    var files = snapshot.entries.map(function (entry) {
      return { name: entry.zipPath, bytes: uint8FromSigned_(pdfBytes_(entry.fileId)) };
    });
    var zipped = storedZip_(files);
    var created = packFolder_().createFile(uint8ToBlob_(zipped, 'application/zip', snapshot.name));
    shareView_(created, '');
    var manifest = {
      folderId: snapshot.folderId,
      fingerprint: snapshot.fingerprint,
      fileId: created.getId(),
      name: snapshot.name,
      size: zipped.length,
      url: 'https://drive.google.com/file/d/' + created.getId() + '/view',
      builtAt: isoKst_(),
    };
    writeManifest_(manifest);
    return manifest;
  } catch (error) {
    if (error && error.code === 'PACK_FAILED') throw error;
    fail_('PACK_FAILED', '압축파일을 만들지 못했습니다.');
  }
}

function ensureMaterialZip_(folderId) {
  ensurePackFolder_();
  var snapshot = packSnapshot_(folderId);
  var hit = freshPack_(folderId, snapshot.fingerprint);
  if (hit) return packReady_(hit, snapshot);
  var buildingKey = 'pack:building:' + folderId;
  var gate;
  try {
    gate = withScriptLock_(function () {
      hit = freshPack_(folderId, snapshot.fingerprint);
      if (hit) return { hit: hit };
      var cache = CacheService.getScriptCache();
      if (cache.get(buildingKey)) return { building: true };
      cache.put(buildingKey, '1', 300);
      return { claimed: true };
    }, 15000);
  } catch (ignore) {
    return { ready: false, building: true, folderDate: snapshot.folderDate };
  }
  if (gate.hit) return packReady_(gate.hit, snapshot);
  if (gate.building) return { ready: false, building: true, folderDate: snapshot.folderDate };
  try {
    return packReady_(buildPack_(snapshot), snapshot);
  } finally {
    try {
      CacheService.getScriptCache().remove(buildingKey);
    } catch (ignore) {}
  }
}

var PACK_WATCH_HANDLER_ = 'prepareMeetingPack';
var PACK_AT_HANDLER_ = 'prepareMeetingPackAt';
var PACK_DELAY_MS_ = 10 * 60 * 1000;

function packDueMs_(meeting) {
  if (!meeting || !meeting.meetingDate || !meeting.meetingTime) return null;
  var start = new Date(meeting.meetingDate + 'T' + meeting.meetingTime + ':00+09:00').getTime();
  if (isNaN(start)) return null;
  return start + PACK_DELAY_MS_;
}

function prepareMeetingPackAt() {
  prepareMeetingPack();
}

/** Builds the meeting zip once 10 minutes have passed, and again when the files changed. */
function prepareMeetingPack() {
  var meeting = getMeeting_();
  var due = packDueMs_(meeting);
  if (due === null || Date.now() < due) return;
  var data;
  try {
    data = loadTree_();
  } catch (ignore) {
    return;
  }
  var folders = (data && data.folders) || [];
  var folder = null;
  for (var i = 0; i < folders.length; i++) {
    if (folders[i].dateKey === meeting.meetingDate) folder = folders[i];
  }
  if (!folder || !folder.id) return;
  try {
    ensureMaterialZip_(folder.id);
  } catch (ignoreBuild) {}
}

function syncPackTrigger_(meeting) {
  var due = packDueMs_(meeting);
  var stamp = due ? String(due) : 'none';
  var cache = CacheService.getScriptCache();
  try {
    if (cache.get('pack:trigger') === stamp) return;
  } catch (ignore) {}
  var triggers = ScriptApp.getProjectTriggers();
  var watch = false;
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === PACK_WATCH_HANDLER_) {
      if (watch) ScriptApp.deleteTrigger(triggers[i]);
      else watch = true;
      continue;
    }
    if (handler === PACK_AT_HANDLER_) ScriptApp.deleteTrigger(triggers[i]);
  }
  if (!watch) ScriptApp.newTrigger(PACK_WATCH_HANDLER_).timeBased().everyMinutes(5).create();
  if (due && due > Date.now() + 60 * 1000) {
    try {
      ScriptApp.newTrigger(PACK_AT_HANDLER_).timeBased().at(new Date(due)).create();
    } catch (ignoreAt) {}
  }
  try {
    cache.put('pack:trigger', stamp, 21600);
  } catch (ignore) {}
}

function materialZip(payload) {
  var folderId = String((payload && payload.folderId) || '');
  if (!folderId) fail_('INVALID_INPUT', '날짜 폴더가 없습니다.');
  try {
    return ensureMaterialZip_(folderId);
  } catch (error) {
    if (error && error.code === 'PACK_FAILED') return { ready: false, building: false };
    throw error;
  }
}

function escapePackHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appendPackLink_(html, text, url, attached, personal) {
  if (!url || String(html).indexOf(url) >= 0) return { html: html, text: text };
  var line = attached
    ? '압축파일은 첨부와 같은 파일이고, 아래 링크에서도 열 수 있습니다.'
    : personal
      ? '첨부 용량이 커서 Drive 링크로 보냅니다. 7일간 보관됩니다.'
      : '첨부 용량이 커서 Drive 링크로 보냅니다.';
  var safe = escapePackHtml_(url);
  return {
    html: html + '<p>' + line + '<br><a href="' + safe + '">' + safe + '</a></p>',
    text: text + '\n' + line + '\n' + url,
  };
}

function cleanReplacements_(items) {
  return (items || []).map(function (item) {
    var zipPath = String(item.zipPath || '');
    if (!zipPath || zipPath.indexOf('..') >= 0 || zipPath.charAt(0) === '/' || zipPath.indexOf('\\') >= 0) {
      fail_('INVALID_INPUT', '바꿀 파일 경로가 올바르지 않습니다.');
    }
    if (!item.base64) fail_('INVALID_INPUT', '바꿀 PDF가 없습니다.');
    return { zipPath: zipPath, base64: String(item.base64) };
  });
}

function stageBlob_(blob, payload, req) {
  var dateName = String(payload.folderDate || 'undated');
  var bucketName = String((req && req.deviceId) || 'send').slice(0, 8) + '_' + String(payload.sendId || Utilities.getUuid());
  var bucketId = withScriptLock_(function () {
    var root = DriveApp.getFolderById(ensureResultFolder_());
    var dateFolder = getOrCreate_(root, dateName);
    return getOrCreate_(dateFolder, bucketName).getId();
  }, 15000);
  var bucket = DriveApp.getFolderById(bucketId);
  var created = bucket.createFile(blob);
  var folderShare = shareView_(bucket, payload.to);
  var url = folderShare ? 'https://drive.google.com/drive/folders/' + bucket.getId() : '';
  if (!url) {
    shareView_(created, payload.to);
    url = created.getUrl();
  }
  return url;
}

function resolvePackMail_(payload, req) {
  var folderId = String(payload.folderId || '');
  if (!folderId) fail_('INVALID_INPUT', '날짜 폴더가 없습니다.');
  var ensured = ensureMaterialZip_(folderId);
  if (!ensured || !ensured.ready) fail_('PACK_FAILED', '압축파일을 준비하지 못했습니다. 다시 시도해 주세요.');
  var file = DriveApp.getFileById(ensured.fileId);
  var replacements = cleanReplacements_(payload.replacements);
  var html = String(payload.htmlBody || '');
  var text = String(payload.textBody || '');
  if (!replacements.length) {
    var size = Number(ensured.size || file.getSize());
    shareView_(file, payload.to);
    if (size > MAX_ATTACH_BYTES_) {
      var linked = appendPackLink_(html, text, ensured.url, false, false);
      return { mode: 'link', blob: null, htmlBody: linked.html, textBody: linked.text, totalBytes: size };
    }
    var both = appendPackLink_(html, text, ensured.url, true, false);
    return {
      mode: 'attach',
      blob: file.getBlob().setName(ensured.name),
      htmlBody: both.html,
      textBody: both.text,
      totalBytes: size,
    };
  }
  var patched;
  try {
    patched = patchStoredZip_(uint8FromSigned_(file.getBlob().getBytes()), replacements.map(function (item) {
      return { name: item.zipPath, bytes: uint8FromBase64_(item.base64) };
    }));
  } catch (error) {
    if (error && error.code) throw error;
    fail_('PACK_FAILED', '메모를 압축에 넣지 못했습니다.');
  }
  var blob = uint8ToBlob_(patched, 'application/zip', ensured.name);
  if (patched.length > MAX_ATTACH_BYTES_) {
    var personalUrl = stageBlob_(blob, payload, req);
    var personal = appendPackLink_(html, text, personalUrl, false, true);
    return { mode: 'link', blob: null, htmlBody: personal.html, textBody: personal.text, totalBytes: patched.length };
  }
  return { mode: 'attach', blob: blob, htmlBody: html, textBody: text, totalBytes: patched.length };
}
