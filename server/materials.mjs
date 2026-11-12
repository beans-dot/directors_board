import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoMeetingPlan, nextFixedMeetingDate, todayKey, weekdayKey } from './holiday.mjs';

export const BUCKETS = ['본문', '별첨', '규정'];
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const FOLDER_RE = /^(\d{2})\.(\d{1,2})\.(\d{1,2})\.?$/;
const serverDir = path.dirname(fileURLToPath(import.meta.url));

export function defaultMaterialsDir() {
  if (process.env.MATERIALS_DIR) return path.resolve(process.env.MATERIALS_DIR);
  if (process.env.NODE_ENV === 'production') return '/var/www/depthm-data/materials';
  return path.join(serverDir, 'data', 'materials');
}

export function defaultDbPath(root) {
  if (process.env.DEPTHM_DB) return path.resolve(process.env.DEPTHM_DB);
  return path.join(path.dirname(path.resolve(root)), 'depthm.sqlite');
}

export function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2099 || month < 1 || month > 12) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const folderDate = `${String(year).slice(-2)}.${match[2]}.${match[3]}.`;
  return { folderDate, dateKey: `${match[1]}-${match[2]}-${match[3]}` };
}

export function parseFolderName(name) {
  const match = String(name || '').trim().match(FOLDER_RE);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { folderDate: `${String(year).slice(-2)}.${mm}.${dd}.`, dateKey: `${year}-${mm}-${dd}` };
}

export function fileIdOf(rel) {
  return `mat_${Buffer.from(rel, 'utf8').toString('base64url')}`;
}

export function pathFromId(id) {
  const raw = String(id || '');
  if (!raw.startsWith('mat_')) return null;
  let rel = '';
  try {
    rel = Buffer.from(raw.slice(4), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!rel || rel.includes('..') || rel.includes('\\') || rel.startsWith('/') || rel.includes('\0')) return null;
  return rel;
}

export function resolveInside(root, rel) {
  return inside(root, rel);
}

function inside(root, rel) {
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function stamp(stat) {
  return crypto.createHash('md5').update(`${stat.mtimeMs}:${stat.size}`).digest('hex');
}

function nodeForFile(rel, stat) {
  return {
    id: fileIdOf(rel),
    name: path.posix.basename(rel),
    kind: 'file',
    mimeType: 'application/pdf',
    isPdf: true,
    modifiedTime: stat.mtime.toISOString(),
    md5Checksum: stamp(stat),
    size: stat.size,
    path: rel,
  };
}

function walk(dir, rel, depth) {
  if (depth > 8) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      nodes.push({
        id: fileIdOf(childRel),
        name: entry.name,
        kind: 'folder',
        mimeType: 'application/vnd.google-apps.folder',
        isPdf: false,
        modifiedTime: stat.mtime.toISOString(),
        md5Checksum: '',
        size: 0,
        path: childRel,
        children: walk(full, childRel, depth + 1),
      });
    } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      nodes.push(nodeForFile(childRel, stat));
    }
  }
  return nodes;
}

export function ensureRoot(root) {
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function createDateFolder(root, dateKey) {
  const meta = parseDateKey(dateKey);
  if (!meta) fail(400, 'INVALID_INPUT', '회의 날짜를 선택해 주세요.');
  ensureRoot(root);
  const dir = inside(root, meta.folderDate);
  if (!dir) fail(400, 'INVALID_INPUT', '회의 날짜를 선택해 주세요.');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of BUCKETS) fs.mkdirSync(path.join(dir, name), { recursive: true });
  return { folderDate: meta.folderDate, dateKey: meta.dateKey, folderId: fileIdOf(meta.folderDate), url: '' };
}

export function listTree(root) {
  ensureRoot(root);
  const folders = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const parsed = parseFolderName(entry.name);
    if (!parsed) continue;
    const full = path.join(root, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    folders.push({
      id: fileIdOf(entry.name),
      name: entry.name,
      kind: 'folder',
      mimeType: 'application/vnd.google-apps.folder',
      isPdf: false,
      modifiedTime: stat.mtime.toISOString(),
      md5Checksum: '',
      size: 0,
      path: entry.name,
      folderDate: parsed.folderDate,
      dateKey: parsed.dateKey,
      children: walk(full, entry.name, 1),
    });
  }
  return { fetchedAt: new Date().toISOString(), folders };
}

export function readStoredFile(root, id) {
  const rel = pathFromId(id);
  if (!rel || !/\.pdf$/i.test(rel)) return null;
  const full = inside(root, rel);
  if (!full) return null;
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  return { full, rel, stat, name: path.basename(full) };
}

function statePath(root) {
  return path.join(root, '.state.json');
}

export function readState(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
    return {
      meetingAuto: parsed.meetingAuto === true,
      meetingDate: String(parsed.meetingDate || ''),
      meetingTime: String(parsed.meetingTime || ''),
      autoDone: String(parsed.autoDone || ''),
      meetingAutoWeekday: Number.isInteger(Number(parsed.meetingAutoWeekday)) ? Number(parsed.meetingAutoWeekday) : 1,
      meetingAutoTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(parsed.meetingAutoTime || '')) ? String(parsed.meetingAutoTime) : '10:00',
    };
  } catch {
    return { meetingAuto: false, meetingDate: '', meetingTime: '', autoDone: '', meetingAutoWeekday: 1, meetingAutoTime: '10:00' };
  }
}

function writeState(root, state) {
  ensureRoot(root);
  fs.writeFileSync(statePath(root), JSON.stringify(state));
}

export function saveMeetingState(root, payload) {
  const state = readState(root);
  if (payload.clearMeeting) {
    state.meetingDate = '';
    state.meetingTime = '';
  }
  if (payload.meetingDate) {
    const meta = parseDateKey(payload.meetingDate);
    if (!meta) fail(400, 'INVALID_INPUT', '회의 날짜를 선택해 주세요.');
    const time = String(payload.meetingTime || '09:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'INVALID_INPUT', '회의 시간은 HH:mm 형식이어야 합니다.');
    state.meetingDate = meta.dateKey;
    state.meetingTime = time;
  }
  if (payload.meetingAuto != null) state.meetingAuto = payload.meetingAuto === true;
  if (payload.meetingAutoWeekday != null) {
    const day = Number(payload.meetingAutoWeekday);
    if (!Number.isInteger(day) || day < 0 || day > 6) fail(400, 'INVALID_INPUT', '요일을 선택해 주세요.');
    state.meetingAutoWeekday = day;
  }
  if (payload.meetingAutoTime != null) {
    const time = String(payload.meetingAutoTime || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'INVALID_INPUT', '회의 시간은 HH:mm 형식이어야 합니다.');
    state.meetingAutoTime = time;
  }
  writeState(root, state);
  return {
    meetingAuto: state.meetingAuto,
    meetingDate: state.meetingDate,
    meetingTime: state.meetingTime,
    meetingAutoWeekday: state.meetingAutoWeekday ?? 1,
    meetingAutoTime: state.meetingAutoTime || '10:00',
  };
}

export function runSchedule(root, now = new Date()) {
  const state = readState(root);
  const today = todayKey(now);
  const hourText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const hour = Number(hourText) % 24;
  let changed = false;
  if (state.meetingAuto && weekdayKey(today) === 1 && hour >= 13 && hour <= 20 && state.autoDone !== today) {
    const plan = autoMeetingPlan(today, state.meetingAutoWeekday ?? 1, state.meetingAutoTime || '10:00');
    state.autoDone = today;
    changed = true;
    if (plan) {
      createDateFolder(root, plan.dateKey);
      state.meetingDate = plan.dateKey;
      state.meetingTime = plan.time;
    }
  }
  const fixed = state.meetingDate ? nextFixedMeetingDate(state.meetingDate, today) : null;
  if (fixed) {
    createDateFolder(root, fixed);
    state.meetingDate = fixed;
    if (!state.meetingTime) state.meetingTime = '10:00';
    changed = true;
  }
  if (changed) writeState(root, state);
  return state;
}

export function safePdfName(raw) {
  let name = '';
  try {
    name = decodeURIComponent(String(raw || ''));
  } catch {
    name = String(raw || '');
  }
  name = path.basename(name.replace(/[\\/:*?"<>|]/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  if (name === '.pdf' || name.length > 180) fail(400, 'INVALID_INPUT', 'PDF 파일 이름이 올바르지 않습니다.');
  return name;
}

export function storeUpload(root, folderDate, category, filename, bytes) {
  const parsed = parseFolderName(folderDate);
  if (!parsed) fail(400, 'INVALID_INPUT', '자료 폴더를 먼저 만들어 주세요.');
  let bucket = '';
  try {
    bucket = decodeURIComponent(String(category || ''));
  } catch {
    bucket = String(category || '');
  }
  if (!BUCKETS.includes(bucket)) fail(400, 'INVALID_INPUT', '구분은 본문, 별첨, 규정 중 하나여야 합니다.');
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) fail(400, 'TOO_LARGE', 'PDF는 30MB 이하만 올릴 수 있습니다.');
  const head = bytes.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF')) fail(400, 'NOT_PDF', 'PDF만 올릴 수 있습니다.');
  const name = safePdfName(filename);
  const rel = `${parsed.folderDate}/${bucket}/${name}`;
  const full = inside(root, rel);
  if (!full) fail(400, 'INVALID_INPUT', 'PDF 파일 이름이 올바르지 않습니다.');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return { path: rel, name, id: fileIdOf(rel) };
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}
