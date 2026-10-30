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
  var nodes = [];
  listChildren_(parentId).forEach(function (child) {
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

function tree(payload, req) {
  var rootId = getRootFolderId_();
  if (!rootId) fail_('CONFIG_MISSING', '자료 폴더가 설정되지 않았습니다. Admin 운영 설정에서 폴더를 지정해 주세요.');
  var folders = [];
  listChildren_(rootId).forEach(function (child) {
    if (child.mimeType !== 'application/vnd.google-apps.folder' && child.mimeType !== 'application/vnd.google-apps.shortcut') return;
    var resolved = resolveShortcut_(child) || child;
    if (resolved.mimeType !== 'application/vnd.google-apps.folder') return;
    var parsed = parseFolderName_(resolved.name);
    if (!parsed) return;
    var seen = {};
    seen[resolved.id] = true;
    var node = baseNode_(resolved, parsed.folderDate);
    node.name = parsed.folderDate;
    node.folderDate = parsed.folderDate;
    node.dateKey = parsed.dateKey;
    node.children = childNodes_(resolved.id, parsed.folderDate, seen);
    folders.push(node);
  });
  folders.sort(function (a, b) { return a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0; });
  if (payload.reason !== 'preload') {
    try {
      withScriptLock_(function () {
        var reason = payload.reason === 'refresh' ? '새로고침' : '접속';
        var device = touchDevice_(req.deviceId);
        appendAccess_({ deviceId: req.deviceId, name: device && device.name, action: reason, folderDate: todayFolderDate_() });
      }, 8000);
    } catch (ignore) {}
  }
  return { fetchedAt: isoKst_(), folders: folders };
}

function isUnderRoot_(fileId, rootId) {
  var current = fileId;
  var guard = 0;
  while (current && guard < 40) {
    if (current === rootId) return true;
    var meta = Drive.Files.get(current, { fields: 'parents', supportsAllDrives: true });
    var parents = meta.parents || [];
    if (!parents.length) return false;
    current = parents[0];
    guard++;
  }
  return false;
}

function file(payload) {
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
  if (!isUnderRoot_(fileId, rootId)) fail_('NOT_FOUND', '파일을 찾을 수 없습니다.');
  if (meta.mimeType !== 'application/pdf') fail_('NOT_PDF', 'PDF만 열람할 수 있습니다.');
  if (Number(meta.size || 0) > MAX_PDF_BYTES_) fail_('TOO_LARGE', '파일이 너무 큽니다. Admin에게 문의');
  var blob = DriveApp.getFileById(fileId).getBlob();
  return {
    fileId: meta.id,
    name: meta.name,
    mimeType: 'application/pdf',
    modifiedTime: meta.modifiedTime || '',
    md5Checksum: meta.md5Checksum || '',
    size: Number(meta.size || blob.getBytes().length),
    base64: Utilities.base64Encode(blob.getBytes()),
  };
}

function ensureResultFolder_() {
  var existing = props_().getProperty('RESULT_FOLDER_ID');
  if (existing) return existing;
  var rootId = getRootFolderId_();
  var parent = rootId ? DriveApp.getFolderById(rootId).getParents().next() : DriveApp.getRootFolder();
  var created = parent.createFolder('_발송결과');
  props_().setProperty('RESULT_FOLDER_ID', created.getId());
  return created.getId();
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
  var url = 'https://drive.google.com/drive/folders/' + bucket.getId();
  try {
    created.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (ignore) {
    try {
      created.addViewer(payload.to);
    } catch (ignoreViewer) {
      url = created.getUrl();
    }
  }
  return { fileId: created.getId(), url: url };
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

function ensureDateFolder_(dateKey) {
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
  var rootId = getRootFolderId_();
  if (!rootId) fail_('CONFIG_MISSING', '자료 폴더가 설정되지 않았습니다. 운영 설정에서 Drive 폴더를 먼저 지정해 주세요.');
  var folderDate = ('0' + (year % 100)).slice(-2) + '.' + match[2] + '.' + match[3] + '.';
  var canonicalKey = match[1] + '-' + match[2] + '-' + match[3];
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
