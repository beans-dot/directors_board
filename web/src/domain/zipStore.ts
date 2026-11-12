/** Stored zip with the UTF-8 name flag, so Korean paths stay readable. */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function writeLocal(nameBytes: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
  const out = new Uint8Array(30 + nameBytes.length + data.length);
  const view = new DataView(out.buffer);
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

function writeCentral(meta: {
  nameBytes: Uint8Array;
  flag: number;
  method: number;
  crc: number;
  compSize: number;
  uncompSize: number;
  offset: number;
}): Uint8Array {
  const out = new Uint8Array(46 + meta.nameBytes.length);
  const view = new DataView(out.buffer);
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

function writeEocd(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const out = new Uint8Array(22);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, cdSize, true);
  view.setUint32(16, cdOffset, true);
  return out;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEocd(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let index = bytes.length - 22; index >= min; index -= 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
      return index;
    }
  }
  throw new Error('압축파일을 읽지 못했습니다.');
}

interface CentralEntry {
  name: string;
  nameBytes: Uint8Array;
  flag: number;
  method: number;
  crc: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

function parseCentral(bytes: Uint8Array): CentralEntry[] {
  const eocdAt = findEocd(bytes);
  const count = readU16(bytes, eocdAt + 10);
  let cursor = readU32(bytes, eocdAt + 16);
  const entries: CentralEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (readU32(bytes, cursor) !== 0x02014b50) throw new Error('압축파일을 읽지 못했습니다.');
    const flag = readU16(bytes, cursor + 8);
    const method = readU16(bytes, cursor + 10);
    const crc = readU32(bytes, cursor + 16);
    const compSize = readU32(bytes, cursor + 20);
    const uncompSize = readU32(bytes, cursor + 24);
    const nameLen = readU16(bytes, cursor + 28);
    const extraLen = readU16(bytes, cursor + 30);
    const commentLen = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLen);
    entries.push({
      name: new TextDecoder().decode(nameBytes),
      nameBytes,
      flag,
      method,
      crc,
      compSize,
      uncompSize,
      localOffset,
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function localSliceLength(bytes: Uint8Array, offset: number, compSize: number): number {
  if (readU32(bytes, offset) !== 0x04034b50) throw new Error('압축파일을 읽지 못했습니다.');
  const flag = readU16(bytes, offset + 6);
  if (flag & 0x8) throw new Error('압축파일을 읽지 못했습니다.');
  const nameLen = readU16(bytes, offset + 26);
  const extraLen = readU16(bytes, offset + 28);
  return 30 + nameLen + extraLen + compSize;
}

export function storedZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = writeLocal(nameBytes, file.bytes, crc);
    locals.push(local);
    centrals.push(
      writeCentral({
        nameBytes,
        flag: 0x800,
        method: 0,
        crc,
        compSize: file.bytes.length,
        uncompSize: file.bytes.length,
        offset,
      }),
    );
    offset += local.length;
  }
  const directory = concatBytes(centrals);
  return concatBytes([...locals, directory, writeEocd(files.length, directory.length, offset)]);
}

export function patchStoredZip(zip: Uint8Array, replacements: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const byName = new Map(replacements.map((item) => [item.name, item.bytes]));
  const entries = parseCentral(zip);
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const used = new Set<string>();
  let offset = 0;
  for (const entry of entries) {
    const next = byName.get(entry.name);
    if (next) {
      used.add(entry.name);
      const nameBytes = encoder.encode(entry.name);
      const crc = crc32(next);
      const local = writeLocal(nameBytes, next, crc);
      locals.push(local);
      centrals.push(
        writeCentral({
          nameBytes,
          flag: 0x800,
          method: 0,
          crc,
          compSize: next.length,
          uncompSize: next.length,
          offset,
        }),
      );
      offset += local.length;
      continue;
    }
    if (entry.compSize === 0xffffffff || entry.uncompSize === 0xffffffff) throw new Error('압축파일을 읽지 못했습니다.');
    const length = localSliceLength(zip, entry.localOffset, entry.compSize);
    const local = zip.slice(entry.localOffset, entry.localOffset + length);
    locals.push(local);
    centrals.push(
      writeCentral({
        nameBytes: entry.nameBytes,
        flag: entry.flag,
        method: entry.method,
        crc: entry.crc,
        compSize: entry.compSize,
        uncompSize: entry.uncompSize,
        offset,
      }),
    );
    offset += local.length;
  }
  for (const name of byName.keys()) {
    if (!used.has(name)) throw new Error('바꿀 파일을 압축에서 찾지 못했습니다.');
  }
  const directory = concatBytes(centrals);
  return concatBytes([...locals, directory, writeEocd(entries.length, directory.length, offset)]);
}

/** Store-method zip grows by the PDF size difference. Header bytes are ignored. */
export function estimatePatchedBytes(baseBytes: number, swaps: { before: number; after: number }[]): number {
  return swaps.reduce((total, swap) => total - swap.before + swap.after, baseBytes);
}
