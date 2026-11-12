function listChildren_(parentId) {
  var files = [];
  var pageToken;
  do {
    var res = Drive.Files.list({
      q: "'" + parentId.replace(/'/g, "\\'") + "' in parents and trashed = false",
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,md5Checksum,size,shortcutDetails)',
      pageSize: 200,
      pageToken: pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files = files.concat(res.files || []);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return files;
}

function parseFolderName_(name) {
  var match = String(name || '').trim().match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})\.?$/);
  if (!match) return null;
  var year = 2000 + Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  var yy = String(year).slice(-2);
  var mm = ('0' + month).slice(-2);
  var dd = ('0' + day).slice(-2);
  return { folderDate: yy + '.' + mm + '.' + dd + '.', dateKey: year + '-' + mm + '-' + dd };
}

function naturalCompare_(a, b) {
  var aNum = /^\d/.test(a);
  var bNum = /^\d/.test(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  return String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' });
}

function resolveShortcut_(file) {
  if (file.mimeType !== 'application/vnd.google-apps.shortcut') return file;
  var target = file.shortcutDetails && file.shortcutDetails.targetId;
  if (!target) return null;
  try {
    return Drive.Files.get(target, {
      fields: 'id,name,mimeType,modifiedTime,md5Checksum,size',
      supportsAllDrives: true,
    });
  } catch (ignore) {
    return null;
  }
}

function baseNode_(file, nodePath) {
  var isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  return {
    id: file.id,
    name: file.name,
    kind: isFolder ? 'folder' : 'file',
    mimeType: file.mimeType,
    isPdf: file.mimeType === 'application/pdf',
    modifiedTime: file.modifiedTime || '',
    md5Checksum: file.md5Checksum || '',
    size: Number(file.size || 0),
    path: nodePath,
  };
}

function childNodes_(parentId, parentPath, seen) {
  return childNodesFrom_(listChildren_(parentId), parentPath, seen);
}

function childNodesFrom_(files, parentPath, seen) {
  var nodes = [];
  files.forEach(function (child) {
    var resolved = resolveShortcut_(child);
    if (!resolved || seen[resolved.id]) return;
    seen[resolved.id] = true;
    var node = baseNode_(resolved, parentPath + '/' + resolved.name);
    if (node.kind === 'folder') {
      node.children = childNodes_(resolved.id, node.path, seen);
      if (!node.children.length) return;
    } else if (!node.isPdf) {
      return;
    }
    nodes.push(node);
  });
  nodes.sort(function (a, b) { return naturalCompare_(a.name, b.name); });
  return nodes;
}

var TREE_CACHE_TTL_ = 120;
var TREE_FOLDER_TTL_ = 21600;
var TREE_CACHE_ALL_ = 'tree:all';
var TREE_CACHE_META_ = 'tree:meta';
var TREE_BUILDING_ = 'tree:building';
var TREE_DATE_INDEX_ = 'tree:dids';

function treeCacheBytes_(text) {
  return Utilities.newBlob(String(text || '')).getBytes().length;
}

function readCachedTree_() {
  var cache = CacheService.getScriptCache();
  var packed = cache.get(TREE_CACHE_ALL_);
  if (packed) {
    try {
      return JSON.parse(packed);
    } catch (ignore) {
      return null;
    }
  }
  var metaRaw = cache.get(TREE_CACHE_META_);
  if (!metaRaw) return null;
  var meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch (ignore) {
    return null;
  }
  var ids = meta.ids || [];
  if (!ids.length) return { fetchedAt: meta.fetchedAt, folders: [] };
  var folders = [];
  var index;
  for (index = 0; index < ids.length; index += 100) {
    var slice = ids.slice(index, index + 100);
    var keys = slice.map(function (id) { return 'tree:f:' + id; });
    var found = cache.getAll(keys);
    var cursor;
    for (cursor = 0; cursor < slice.length; cursor += 1) {
      var raw = found['tree:f:' + slice[cursor]];
      if (!raw) return null;
      try {
        folders.push(JSON.parse(raw));
      } catch (ignore) {
        return null;
      }
    }
  }
  return { fetchedAt: meta.fetchedAt, folders: folders };
}

function writeCachedTree_(data) {
  var cache = CacheService.getScriptCache();
  var packed = JSON.stringify(data);
  if (treeCacheBytes_(packed) <= 90000) {
    cache.put(TREE_CACHE_ALL_, packed, TREE_CACHE_TTL_);
    cache.remove(TREE_CACHE_META_);
    return;
  }
  cache.remove(TREE_CACHE_ALL_);
  cache.remove(TREE_CACHE_META_);
  var ids = [];
  var tooBig = false;
  data.folders.forEach(function (folder) {
    var body = JSON.stringify(folder);
    if (treeCacheBytes_(body) > 90000) {
      tooBig = true;
      return;
    }
    cache.put('tree:f:' + folder.id, body, TREE_CACHE_TTL_);
    ids.push(folder.id);
  });
  if (tooBig) return;
  cache.put(TREE_CACHE_META_, JSON.stringify({ fetchedAt: data.fetchedAt, ids: ids }), TREE_CACHE_TTL_);
}

function clearTreeCache_() {
  try {
    var cache = CacheService.getScriptCache();
    var metaRaw = cache.get(TREE_CACHE_META_);
    var keys = [TREE_CACHE_ALL_, TREE_CACHE_META_, TREE_BUILDING_, TREE_DATE_INDEX_];
    if (metaRaw) {
      try {
        var meta = JSON.parse(metaRaw);
        (meta.ids || []).forEach(function (id) { keys.push('tree:f:' + id); });
      } catch (ignore) {}
    }
    var dateRaw = cache.get(TREE_DATE_INDEX_);
    if (dateRaw) {
      try {
        JSON.parse(dateRaw).forEach(function (id) { keys.push('tree:d:' + id); });
      } catch (ignoreDates) {}
    }
    while (keys.length) cache.removeAll(keys.splice(0, 100));
    cache.put('tree:gen', String(Date.now()), 21600);
  } catch (ignore) {}
}

function treeGen_() {
  try {
    return CacheService.getScriptCache().get('tree:gen') || '0';
  } catch (ignore) {
    return '0';
  }
}

function loadTree_() {
  var cached = readCachedTree_();
  if (cached) return cached;
  return buildTreeShared_();
}

function buildTreeShared_() {
  var token = Utilities.getUuid();
  var gen = treeGen_();
  var mine = false;
  var lock = null;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(8000);
    var cached = readCachedTree_();
    if (cached) return cached;
    var cache = CacheService.getScriptCache();
    if (!cache.get(TREE_BUILDING_)) {
      cache.put(TREE_BUILDING_, token, 90);
      mine = true;
    }
  } catch (ignore) {
    mine = true;
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (ignoreRelease) {}
    }
  }
  if (!mine) {
    var started = Date.now();
    while (Date.now() - started < 60000) {
      Utilities.sleep(400);
      var ready = readCachedTree_();
      if (ready) return ready;
      if (!CacheService.getScriptCache().get(TREE_BUILDING_)) break;
    }
  }
  try {
    var built = collectTree_();
    try {
      if (treeGen_() === gen) writeCachedTree_(built);
    } catch (ignoreWrite) {}
    return built;
  } finally {
    if (mine) {
      try {
        var building = CacheService.getScriptCache();
        if (building.get(TREE_BUILDING_) === token) building.remove(TREE_BUILDING_);
      } catch (ignoreClear) {}
    }
  }
}

function folderSignature_(files) {
  return files.map(function (file) {
    var target = file.shortcutDetails && file.shortcutDetails.targetId ? file.shortcutDetails.targetId : '';
    return [file.id, file.mimeType || '', file.modifiedTime || '', file.md5Checksum || '', String(file.size || ''), target].join('\t');
  }).sort().join('\n');
}

function readDateFolder_(id) {
  try {
    var raw = CacheService.getScriptCache().get('tree:d:' + id);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && parsed.node ? parsed : null;
  } catch (ignore) {
    return null;
  }
}

function rememberDateFolder_(id, signature, name, node) {
  var cache = CacheService.getScriptCache();
  var body = JSON.stringify({ signature: signature, name: name, node: node });
  if (treeCacheBytes_(body) > 90000) {
    cache.remove('tree:d:' + id);
    return;
  }
  cache.put('tree:d:' + id, body, TREE_FOLDER_TTL_);
}

function dateFolderNode_(resolved, parsed, files) {
  var seen = {};
  seen[resolved.id] = true;
  var node = baseNode_(resolved, parsed.folderDate);
  node.name = parsed.folderDate;
  node.folderDate = parsed.folderDate;
  node.dateKey = parsed.dateKey;
  node.children = childNodesFrom_(files, parsed.folderDate, seen);
  return node;
}

function deepSignature_(files, depth) {
  var lines = [folderSignature_(files)];
  if (depth <= 0) return lines.join('\n');
  files.forEach(function (child) {
    var resolved = resolveShortcut_(child);
    if (!resolved || resolved.mimeType !== 'application/vnd.google-apps.folder') return;
    lines.push(resolved.id);
    lines.push(deepSignature_(listChildren_(resolved.id), depth - 1));
  });
  return lines.join('\n');
}

function collectPdfIds_(node, out) {
  if (!node) return;
  if (node.isPdf && node.id) out.push(node.id);
  var children = node.children || [];
  for (var i = 0; i < children.length; i++) collectPdfIds_(children[i], out);
}

function rememberUnderRoot_(rootId, ids) {
  if (!rootId || !ids.length) return;
  var cache = CacheService.getScriptCache();
  var batch = {};
  var count = 0;
  function flush() {
    if (!count) return;
    try {
      cache.putAll(batch, 21600);
    } catch (ignore) {}
    batch = {};
    count = 0;
  }
  for (var i = 0; i < ids.length; i++) {
    batch['under:' + rootId + ':' + ids[i]] = '1';
    count++;
    if (count === 80) flush();
  }
  flush();
}

function collectTree_() {
  var rootId = getRootFolderId_();
  if (!rootId) fail_('CONFIG_MISSING', '자료 폴더가 설정되지 않았습니다. Admin 운영 설정에서 폴더를 지정해 주세요.');
  var meetingKey = '';
  try {
    meetingKey = getMeeting_().meetingDate || '';
  } catch (ignoreMeeting) {}
  var folders = [];
  var ids = [];
  listChildren_(rootId).forEach(function (child) {
    if (child.mimeType !== 'application/vnd.google-apps.folder' && child.mimeType !== 'application/vnd.google-apps.shortcut') return;
    var resolved = resolveShortcut_(child) || child;
    if (resolved.mimeType !== 'application/vnd.google-apps.folder') return;
    var parsed = parseFolderName_(resolved.name);
    if (!parsed) return;
    var files = listChildren_(resolved.id);
    var signature = folderSignature_(files);
    if (parsed.dateKey === meetingKey) {
      try {
        signature += '\n#deep\n' + deepSignature_(files, 6);
      } catch (ignoreDeep) {}
    }
    var cached = readDateFolder_(resolved.id);
    var node = cached && cached.signature === signature && cached.name === resolved.name ? cached.node : null;
    if (!node) {
      node = dateFolderNode_(resolved, parsed, files);
      try {
        rememberDateFolder_(resolved.id, signature, resolved.name, node);
      } catch (ignore) {}
    }
    folders.push(node);
    ids.push(resolved.id);
  });
  folders.sort(function (a, b) { return a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0; });
  try {
    CacheService.getScriptCache().put(TREE_DATE_INDEX_, JSON.stringify(ids), TREE_FOLDER_TTL_);
  } catch (ignore) {}
  var pdfIds = [];
  folders.forEach(function (folder) {
    collectPdfIds_(folder, pdfIds);
  });
  rememberUnderRoot_(rootId, pdfIds);
  return { fetchedAt: isoKst_(), folders: folders };
}

function tree(payload, req) {
  var treeRefreshAt = props_().getProperty('TREE_REFRESH_AT') || '';
  var data = loadTree_();
  data.treeRefreshAt = treeRefreshAt;
  if (payload.reason !== 'preload') noteAccess_(payload, req);
  return data;
}

function noteAccess_(payload, req) {
  var key = 'access:' + req.deviceId;
  try {
    if (CacheService.getScriptCache().get(key)) return;
  } catch (ignore) {}
  try {
    withScriptLock_(function () {
      if (CacheService.getScriptCache().get(key)) return;
      var reason = payload.reason === 'refresh' ? '새로고침' : '접속';
      var device = touchDevice_(req.deviceId);
      appendAccess_({ deviceId: req.deviceId, name: device && device.name, action: reason, folderDate: todayFolderDate_() });
      CacheService.getScriptCache().put(key, '1', 600);
    }, 8000);
  } catch (ignore) {}
}

function parentIds_(fileId) {
  var meta = Drive.Files.get(fileId, { fields: 'parents', supportsAllDrives: true });
  return (meta.parents || []).map(function (parent) {
    return typeof parent === 'string' ? parent : parent && parent.id ? parent.id : '';
  }).filter(function (id) { return id; });
}

function isUnderRoot_(fileId, rootId) {
  var pending = [fileId];
  var seen = {};
  var guard = 0;
  while (pending.length && guard < 40) {
    var current = pending.shift();
    if (!current || seen[current]) continue;
    seen[current] = true;
    guard++;
    if (current === rootId) return true;
    var parents = [];
    try {
      parents = parentIds_(current);
    } catch (ignore) {
      continue;
    }
    for (var i = 0; i < parents.length; i++) pending.push(parents[i]);
  }
  return false;
}

function isUnderRootCached_(fileId, rootId) {
  var key = 'under:' + rootId + ':' + fileId;
  var cache = CacheService.getScriptCache();
  try {
    if (cache.get(key) === '1') return true;
  } catch (ignore) {}
  var ok = isUnderRoot_(fileId, rootId);
  if (ok) {
    try {
      cache.put(key, '1', 600);
    } catch (ignorePut) {}
  }
  return ok;
}

function file(payload) {
  return readFilePayload_(payload);
}

function fileMeta(payload) {
  var fileId = String(payload.fileId || '');
  if (!fileId) fail_('INVALID_INPUT', '파일이 지정되지 않았습니다.');
  var rootId = getRootFolderId_();
  if (!rootId) fail_('CONFIG_MISSING', '자료 폴더가 설정되지 않았습니다.');
  var meta;
  try {
    meta = Drive.Files.get(fileId, {
      fields: 'id,name,mimeType,modifiedTime,md5Checksum,size',
      supportsAllDrives: true,
    });
  } catch (ignore) {
    fail_('NOT_FOUND', '파일을 찾을 수 없습니다.');
  }
  if (!isUnderRootCached_(fileId, rootId)) fail_('NOT_FOUND', '파일을 찾을 수 없습니다.');
  if (meta.mimeType !== 'application/pdf') fail_('NOT_PDF', 'PDF만 열람할 수 있습니다.');
  return {
    fileId: meta.id,
    name: meta.name,
    modifiedTime: meta.modifiedTime || '',
    md5Checksum: meta.md5Checksum || '',
    size: Number(meta.size || 0),
  };
}

function pdfBytes_(fileId) {
  try {
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() === 200) return response.getContent();
  } catch (ignore) {}
  return DriveApp.getFileById(fileId).getBlob().getBytes();
}

function readFilePayload_(payload) {
  var fileId = String(payload.fileId || '');
  if (!fileId) fail_('INVALID_INPUT', '파일이 지정되지 않았습니다.');
  var rootId = getRootFolderId_();
  if (!rootId) fail_('CONFIG_MISSING', '자료 폴더가 설정되지 않았습니다.');
  var meta;
  try {
    meta = Drive.Files.get(fileId, {
      fields: 'id,name,mimeType,modifiedTime,md5Checksum,size,parents',
      supportsAllDrives: true,
    });
  } catch (ignore) {
    fail_('NOT_FOUND', '파일을 찾을 수 없습니다.');
  }
  if (!isUnderRootCached_(fileId, rootId)) fail_('NOT_FOUND', '파일을 찾을 수 없습니다.');
  if (meta.mimeType !== 'application/pdf') fail_('NOT_PDF', 'PDF만 열람할 수 있습니다.');
  if (Number(meta.size || 0) > MAX_PDF_BYTES_) fail_('TOO_LARGE', '파일이 너무 큽니다. Admin에게 문의');
  var bytes = pdfBytes_(fileId);
  return {
    fileId: meta.id,
    name: meta.name,
    mimeType: 'application/pdf',
    modifiedTime: meta.modifiedTime || '',
    md5Checksum: meta.md5Checksum || '',
    size: Number(meta.size || bytes.length),
    base64: Utilities.base64Encode(bytes),
  };
}

function ensureResultFolder_() {
  var existing = props_().getProperty('RESULT_FOLDER_ID');
  if (!existing) fail_('CONFIG_MISSING', '발송 결과 폴더가 설정되지 않았습니다. Admin 운영 설정에서 폴더를 지정해 주세요.');
  try {
    DriveApp.getFolderById(existing).getName();
  } catch (ignore) {
    fail_('NOT_FOUND', '발송 결과 폴더를 열 수 없습니다. Admin 운영 설정에서 폴더를 다시 지정해 주세요.');
  }
  return existing;
}

function stage(payload, req) {
  assertRecipient_(payload.to);
  var part = payload.file || {};
  if (!part.name || !part.base64) fail_('INVALID_INPUT', '올릴 파일이 없습니다.');
  var dateName = String(payload.folderDate || 'undated');
  var bucketName = String(req.deviceId).slice(0, 8) + '_' + String(payload.sendId || Utilities.getUuid());
  var bucketId = withScriptLock_(function () {
    var root = DriveApp.getFolderById(ensureResultFolder_());
    var dateFolder = getOrCreate_(root, dateName);
    var bucket = getOrCreate_(dateFolder, bucketName);
    return bucket.getId();
  }, 15000);
  var bucket = DriveApp.getFolderById(bucketId);
  var stagedName = attachmentName_(part.name);
  var blob = Utilities.newBlob(Utilities.base64Decode(part.base64), attachmentMime_(stagedName), stagedName);
  var created = bucket.createFile(blob);
  var folderShare = shareView_(bucket, payload.to);
  var url = folderShare ? 'https://drive.google.com/drive/folders/' + bucket.getId() : '';
  if (!url) {
    shareView_(created, payload.to);
    url = created.getUrl();
  }
  return { fileId: created.getId(), url: url };
}

function shareView_(target, email) {
  try {
    target.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (ignore) {
    try {
      target.addViewer(email);
      return true;
    } catch (ignoreViewer) {
      return false;
    }
  }
}

function getOrCreate_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

var MATERIAL_FOLDERS_ = ['본문', '별첨', '규정'];

function listDateFolders_() {
  var rootId = getRootFolderId_();
  if (!rootId) return [];
  var folders = [];
  listChildren_(rootId).forEach(function (child) {
    if (child.mimeType !== 'application/vnd.google-apps.folder' && child.mimeType !== 'application/vnd.google-apps.shortcut') return;
    var resolved = resolveShortcut_(child) || child;
    if (resolved.mimeType !== 'application/vnd.google-apps.folder') return;
    var parsed = parseFolderName_(resolved.name);
    if (!parsed) return;
    folders.push({
      folderDate: parsed.folderDate,
      dateKey: parsed.dateKey,
      folderId: resolved.id,
      url: 'https://drive.google.com/drive/folders/' + resolved.id,
    });
  });
  folders.sort(function (a, b) {
    return a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0;
  });
  return folders;
}

function folderMetaFromKey_(dateKey) {
  var match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) fail_('INVALID_INPUT', '회의 날짜를 선택해 주세요.');
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (year < 2000 || year > 2099) fail_('INVALID_INPUT', '2000년부터 2099년 사이만 지정할 수 있습니다.');
  var probe = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    fail_('INVALID_INPUT', '없는 날짜입니다.');
  }
  var folderDate = ('0' + (year % 100)).slice(-2) + '.' + match[2] + '.' + match[3] + '.';
  var canonicalKey = match[1] + '-' + match[2] + '-' + match[3];
  return { folderDate: folderDate, dateKey: canonicalKey, folderId: folderDate, url: '' };
}

function ensureDateFolder_(dateKey) {
  var meta = folderMetaFromKey_(dateKey);
  var rootId = getRootFolderId_();
  if (!rootId) fail_('CONFIG_MISSING', '자료 폴더가 설정되지 않았습니다. 운영 설정에서 Drive 폴더를 먼저 지정해 주세요.');
  var folderDate = meta.folderDate;
  var canonicalKey = meta.dateKey;
  var root;
  try {
    root = DriveApp.getFolderById(rootId);
  } catch (ignore) {
    fail_('NOT_FOUND', '자료 폴더를 열 수 없습니다. 운영 설정에서 폴더를 다시 지정해 주세요.');
  }
  var dateFolder = null;
  var it = root.getFolders();
  while (it.hasNext()) {
    var child = it.next();
    var parsed = parseFolderName_(child.getName());
    if (parsed && parsed.dateKey === canonicalKey) {
      dateFolder = child;
      break;
    }
  }
  if (!dateFolder) dateFolder = root.createFolder(folderDate);
  else if (dateFolder.getName() !== folderDate) dateFolder.setName(folderDate);
  MATERIAL_FOLDERS_.forEach(function (name) {
    getOrCreate_(dateFolder, name);
  });
  return {
    folderDate: folderDate,
    dateKey: canonicalKey,
    folderId: dateFolder.getId(),
    url: 'https://drive.google.com/drive/folders/' + dateFolder.getId(),
  };
}
