/** web/src/domain/zipStore.ts 와 같은 무압축 ZIP. 한글 경로가 깨지지 않게 UTF-8 플래그를 넣습니다. */

function crc32_(bytes) {
  var crc = 0xffffffff;
  for (var index = 0; index < bytes.length; index++) {
    crc ^= bytes[index];
    for (var bit = 0; bit < 8; bit++) {
      var mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes_(parts) {
  var total = 0;
  for (var i = 0; i < parts.length; i++) total += parts[i].length;
  var out = new Uint8Array(total);
  var offset = 0;
  for (var j = 0; j < parts.length; j++) {
    out.set(parts[j], offset);
    offset += parts[j].length;
  }
  return out;
}

function writeLocal_(nameBytes, data, crc) {
  var out = new Uint8Array(30 + nameBytes.length + data.length);
  var view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x800, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, nameBytes.length, true);
  out.set(nameBytes, 30);
  out.set(data, 30 + nameBytes.length);
  return out;
}

function writeCentral_(meta) {
  var out = new Uint8Array(46 + meta.nameBytes.length);
  var view = new DataView(out.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, meta.flag, true);
  view.setUint16(10, meta.method, true);
  view.setUint32(16, meta.crc, true);
  view.setUint32(20, meta.compSize, true);
  view.setUint32(24, meta.uncompSize, true);
  view.setUint16(28, meta.nameBytes.length, true);
  view.setUint32(42, meta.offset, true);
  out.set(meta.nameBytes, 46);
  return out;
}

function writeEocd_(count, cdSize, cdOffset) {
  var out = new Uint8Array(22);
  var view = new DataView(out.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, cdSize, true);
  view.setUint32(16, cdOffset, true);
  return out;
}

function readU16_(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32_(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEocd_(bytes) {
  var min = Math.max(0, bytes.length - 22 - 65535);
  for (var index = bytes.length - 22; index >= min; index--) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) return index;
  }
  fail_('PACK_FAILED', '압축파일을 읽지 못했습니다.');
}

function utf8Bytes_(text) {
  var raw = Utilities.newBlob(String(text)).getBytes();
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw[i] & 255;
  return out;
}

function utf8Text_(bytes) {
  var signed = [];
  for (var i = 0; i < bytes.length; i++) {
    var n = bytes[i];
    signed.push(n < 128 ? n : n - 256);
  }
  return Utilities.newBlob(signed).getDataAsString('UTF-8');
}

function uint8FromSigned_(raw) {
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw[i] & 255;
  return out;
}

function uint8FromBase64_(b64) {
  return uint8FromSigned_(Utilities.base64Decode(b64));
}

function uint8ToBlob_(bytes, mime, name) {
  var signed = new Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) {
    var n = bytes[i];
    signed[i] = n < 128 ? n : n - 256;
  }
  return Utilities.newBlob(signed, mime, name);
}

function parseCentral_(bytes) {
  var eocdAt = findEocd_(bytes);
  var count = readU16_(bytes, eocdAt + 10);
  var cursor = readU32_(bytes, eocdAt + 16);
  var entries = [];
  for (var index = 0; index < count; index++) {
    if (readU32_(bytes, cursor) !== 0x02014b50) fail_('PACK_FAILED', '압축파일을 읽지 못했습니다.');
    var nameLen = readU16_(bytes, cursor + 28);
    var extraLen = readU16_(bytes, cursor + 30);
    var commentLen = readU16_(bytes, cursor + 32);
    var nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLen);
    entries.push({
      name: utf8Text_(nameBytes),
      nameBytes: nameBytes,
      flag: readU16_(bytes, cursor + 8),
      method: readU16_(bytes, cursor + 10),
      crc: readU32_(bytes, cursor + 16),
      compSize: readU32_(bytes, cursor + 20),
      uncompSize: readU32_(bytes, cursor + 24),
      localOffset: readU32_(bytes, cursor + 42),
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function localSliceLength_(bytes, offset, compSize) {
  if (readU32_(bytes, offset) !== 0x04034b50) fail_('PACK_FAILED', '압축파일을 읽지 못했습니다.');
  if (readU16_(bytes, offset + 6) & 0x8) fail_('PACK_FAILED', '압축파일을 읽지 못했습니다.');
  return 30 + readU16_(bytes, offset + 26) + readU16_(bytes, offset + 28) + compSize;
}

function storedZip_(files) {
  var locals = [];
  var centrals = [];
  var offset = 0;
  for (var i = 0; i < files.length; i++) {
    var nameBytes = utf8Bytes_(files[i].name);
    var crc = crc32_(files[i].bytes);
    var local = writeLocal_(nameBytes, files[i].bytes, crc);
    locals.push(local);
    centrals.push(writeCentral_({
      nameBytes: nameBytes,
      flag: 0x800,
      method: 0,
      crc: crc,
      compSize: files[i].bytes.length,
      uncompSize: files[i].bytes.length,
      offset: offset,
    }));
    offset += local.length;
  }
  var directory = concatBytes_(centrals);
  return concatBytes_([].concat(locals, [directory, writeEocd_(files.length, directory.length, offset)]));
}

function patchStoredZip_(zip, replacements) {
  var byName = {};
  for (var r = 0; r < replacements.length; r++) byName[replacements[r].name] = replacements[r].bytes;
  var entries = parseCentral_(zip);
  var locals = [];
  var centrals = [];
  var used = {};
  var offset = 0;
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var next = byName[entry.name];
    if (next) {
      used[entry.name] = true;
      var nameBytes = utf8Bytes_(entry.name);
      var crc = crc32_(next);
      var local = writeLocal_(nameBytes, next, crc);
      locals.push(local);
      centrals.push(writeCentral_({
        nameBytes: nameBytes,
        flag: 0x800,
        method: 0,
        crc: crc,
        compSize: next.length,
        uncompSize: next.length,
        offset: offset,
      }));
      offset += local.length;
      continue;
    }
    if (entry.compSize === 0xffffffff || entry.uncompSize === 0xffffffff) fail_('PACK_FAILED', '압축파일을 읽지 못했습니다.');
    var length = localSliceLength_(zip, entry.localOffset, entry.compSize);
    var copied = zip.slice(entry.localOffset, entry.localOffset + length);
    locals.push(copied);
    centrals.push(writeCentral_({
      nameBytes: entry.nameBytes,
      flag: entry.flag,
      method: entry.method,
      crc: entry.crc,
      compSize: entry.compSize,
      uncompSize: entry.uncompSize,
      offset: offset,
    }));
    offset += copied.length;
  }
  for (var name in byName) {
    if (!used[name]) fail_('PACK_FAILED', '바꿀 파일을 압축에서 찾지 못했습니다.');
  }
  var directory = concatBytes_(centrals);
  return concatBytes_([].concat(locals, [directory, writeEocd_(entries.length, directory.length, offset)]));
}
