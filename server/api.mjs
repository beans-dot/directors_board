import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashPassword, openStore, tokenHash, verifyPassword } from './db.mjs';
import { composePdf, contentDisposition, zipPdfs } from './composePdf.mjs';
import { autoMeetingPlan, nextFixedMeetingDate, todayKey, weekdayKey } from './holiday.mjs';
import { BUCKETS, defaultDbPath, defaultMaterialsDir, ensureRoot, parseDateKey, parseFolderName, resolveInside, safePdfName } from './materials.mjs';

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MEMO_TYPES = new Set(['pin', 'highlight', 'underline', 'ink']);
const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const INITIAL_ADMIN_PASSWORD = 'admin';
const DUMMY_HASH = hashPassword('not-a-real-password');

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}${crypto.randomBytes(16).toString('hex')}`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('요청이 너무 큽니다.'), { status: 400, code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function cookieValue(header) {
  for (const part of String(header || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'depthm_session') return decodeURIComponent(rest.join('='));
  }
  return '';
}

function sessionCookie(token, req, clear = false) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const value = clear ? '' : encodeURIComponent(token);
  const age = clear ? 0 : Math.floor(SESSION_MS / 1000);
  return `depthm_session=${value}; HttpOnly; Path=/materials-api; SameSite=Lax; Max-Age=${age}${secure}`;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function requireMutation(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-depthm-request'] !== '1') fail(403, 'FORBIDDEN', '요청을 확인할 수 없습니다.');
}

function issueSession(store, req, res, fields) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_MS;
  store.putSession({
    tokenHash: tokenHash(token),
    userId: fields.userId,
    role: fields.role,
    sessionVersion: fields.sessionVersion,
    mustChange: fields.mustChange,
    adminTag: '',
    expiresAt,
    createdAt: nowIso(),
  });
  return token;
}

function currentSession(store, req) {
  const token = cookieValue(req.headers.cookie);
  if (!token) return null;
  const row = store.session(tokenHash(token));
  if (!row || Number(row.expires_at) < Date.now()) return null;
  if (row.role === 'admin') {
    const version = adminVersion(store);
    if (Number(row.session_version) !== version) return null;
    return {
      role: 'admin',
      userId: 'admin',
      name: '관리자',
      position: '기획처',
      mustChange: adminMustChange(store),
      tokenHash: row.token_hash,
      sessionVersion: version,
    };
  }
  const officer = store.officer(row.user_id);
  if (!officer || officer.active !== 1 || officer.session_version !== row.session_version) return null;
  return {
    role: 'user',
    userId: officer.id,
    name: officer.name,
    position: officer.position,
    mustChange: officer.must_change === 1,
    tokenHash: row.token_hash,
    sessionVersion: officer.session_version,
    officer,
  };
}

function requireUser(store, req) {
  const session = currentSession(store, req);
  if (!session) fail(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
  if (Number(store.session(session.tokenHash)?.expires_at) - Date.now() < SESSION_MS / 2) {
    store.touchSession(session.tokenHash, Date.now() + SESSION_MS, session.mustChange);
  }
  return session;
}

function requireReady(store, req) {
  const session = requireUser(store, req);
  if (session.mustChange) fail(403, 'PASSWORD_CHANGE_REQUIRED', '비밀번호를 새로 설정해 주세요.');
  return session;
}

function requireAdmin(store, req) {
  const session = requireReady(store, req);
  if (session.role !== 'admin') fail(403, 'FORBIDDEN', '관리자만 이 작업을 할 수 있습니다.');
  return session;
}

function publicConfig(store) {
  let tips = [];
  let notices = [];
  try {
    tips = JSON.parse(store.setting('usageTips', '[]'));
  } catch {
    tips = [];
  }
  try {
    notices = JSON.parse(store.setting('changeNotices', '[]'));
  } catch {
    notices = [];
  }
  return {
    today: folderToday(),
    maxAttachBytes: 26_214_400,
    allowedRecipientDomain: 'yeonsung.ac.kr',
    officers: store.roster(),
    meetingDate: store.setting('meetingDate', ''),
    meetingTime: store.setting('meetingTime', ''),
    usageTips: Array.isArray(tips) ? tips : [],
    changeNotices: Array.isArray(notices) ? notices : [],
  };
}

function meetingZipName(meeting) {
  const parsed = parseDateKey(meeting.date_key) || parseFolderName(meeting.folder_date);
  const dotted = parsed ? parsed.dateKey.replace(/-/g, '.') : String(meeting.folder_date || '자료').replace(/\.$/, '');
  return `${dotted} 보직회의자료.zip`;
}

function folderToday() {
  const key = todayKey();
  const parsed = parseDateKey(key);
  return parsed ? parsed.folderDate : '';
}

function storedPath(folderDate, bucket, name) {
  return name ? `${folderDate}/${bucket}/${name}` : `${folderDate}/${bucket}`;
}

function fileNode(meeting, file) {
  return {
    id: file.id,
    name: file.name,
    kind: 'file',
    mimeType: 'application/pdf',
    isPdf: true,
    modifiedTime: file.updated_at,
    md5Checksum: file.sha256,
    size: file.size,
    path: storedPath(meeting.folder_date, file.category, file.name),
  };
}

function treeOf(store) {
  const byDate = new Map();
  for (const meeting of store.meetings()) {
    const list = byDate.get(meeting.folder_date) || [];
    list.push(meeting);
    byDate.set(meeting.folder_date, list);
  }
  const folders = [...byDate.values()].map((meetings) => {
    const meeting = meetings[0];
    const files = meetings.flatMap((item) => store.filesFor(item.id).map((file) => ({ meeting: item, file })));
    return {
      id: meeting.id,
      name: meeting.folder_date,
      kind: 'folder',
      mimeType: 'application/vnd.google-apps.folder',
      isPdf: false,
      modifiedTime: meeting.updated_at,
      md5Checksum: '',
      size: 0,
      path: meeting.folder_date,
      folderDate: meeting.folder_date,
      dateKey: meeting.date_key,
      children: BUCKETS.map((bucket) => ({
        id: `${meeting.folder_date}:${bucket}`,
        name: bucket,
        kind: 'folder',
        mimeType: 'application/vnd.google-apps.folder',
        isPdf: false,
        path: storedPath(meeting.folder_date, bucket),
        children: files.filter((item) => item.file.category === bucket).map((item) => fileNode(item.meeting, item.file)),
      })),
    };
  });
  return { fetchedAt: nowIso(), folders, treeRefreshAt: store.setting('treeRefreshAt', '') };
}

function meetingFolders(store) {
  return store.meetings().map((meeting) => ({
    folderDate: meeting.folder_date,
    dateKey: meeting.date_key,
    folderId: meeting.id,
    url: '',
    time: meeting.time,
    title: meeting.title,
  }));
}

function meetingAdmin(store) {
  return store.meetings().map((meeting) => ({
    id: meeting.id,
    dateKey: meeting.date_key,
    folderDate: meeting.folder_date,
    time: meeting.time,
    title: meeting.title,
    files: store.filesFor(meeting.id).map((file) => ({
      id: file.id,
      name: file.name,
      category: file.category,
      sortOrder: file.sort_order,
      size: file.size,
    })),
  }));
}

function createMeeting(store, root, input) {
  const meta = parseDateKey(input.dateKey);
  if (!meta) fail(400, 'INVALID_INPUT', '회의 날짜를 선택해 주세요.');
  const time = String(input.time || '09:00');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'INVALID_INPUT', '회의 시간은 HH:mm 형식이어야 합니다.');
  const title = String(input.title || '').trim().slice(0, 80) || '보직회의';
  const id = newId('m_');
  const stamp = nowIso();
  for (const bucket of BUCKETS) {
    const dir = resolveInside(root, storedPath(meta.folderDate, bucket));
    if (!dir) fail(400, 'INVALID_INPUT', '회의 폴더를 만들 수 없습니다.');
    fs.mkdirSync(dir, { recursive: true });
  }
  store.insertMeeting({ id, dateKey: meta.dateKey, folderDate: meta.folderDate, time, title, createdAt: stamp, updatedAt: stamp });
  return store.meeting(id);
}

function assertPdf(bytes) {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) fail(400, 'TOO_LARGE', 'PDF는 30MB 이하만 올릴 수 있습니다.');
  if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF')) fail(400, 'NOT_PDF', 'PDF만 올릴 수 있습니다.');
}

function writeOriginal(root, rel, bytes) {
  const full = resolveInside(root, rel);
  if (!full) fail(400, 'INVALID_INPUT', '파일 경로가 올바르지 않습니다.');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const temp = `${full}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, full);
  return full;
}

function readOriginal(root, rel) {
  const full = resolveInside(root, rel);
  if (!full) return null;
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  return { full, stat, bytes: fs.readFileSync(full) };
}

function annotationOf(row, meeting, file) {
  let inkPaths = [];
  try {
    inkPaths = JSON.parse(row.ink_json || '[]');
  } catch {
    inkPaths = [];
  }
  return {
    id: row.id,
    driveFileId: row.file_id,
    path: storedPath(meeting.folder_date, file.category, file.name),
    folderDate: meeting.folder_date,
    topFolder: file.category,
    page: row.page,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    type: row.type,
    content: row.content,
    inkPaths,
    color: row.color,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memoRow(session, file, ann, version, createdAt) {
  return {
    id: ann.id,
    user_id: session.userId,
    meeting_id: file.meeting_id,
    file_id: file.id,
    page: ann.page,
    x: ann.x,
    y: ann.y,
    w: ann.w,
    h: ann.h,
    type: ann.type,
    content: ann.content,
    ink_json: JSON.stringify(ann.inkPaths || []),
    color: ann.color || '',
    status: ann.status,
    version,
    created_at: createdAt,
    updated_at: ann.updatedAt,
  };
}

function normalizeMemo(raw, fileId) {
  if (!raw || typeof raw !== 'object') fail(400, 'INVALID_INPUT', '메모 형식이 올바르지 않습니다.');
  const id = String(raw.id || '');
  if (!ID_RE.test(id)) fail(400, 'INVALID_INPUT', '메모 번호가 올바르지 않습니다.');
  if (String(raw.driveFileId || fileId) !== fileId && raw.driveFileId) {
    /* the file id in the body must match the saved file */
  }
  const type = String(raw.type || '');
  if (!MEMO_TYPES.has(type)) fail(400, 'INVALID_INPUT', '메모 종류가 올바르지 않습니다.');
  const status = raw.status === 'deleted' ? 'deleted' : 'active';
  const page = Number(raw.page);
  const nums = ['x', 'y', 'w', 'h'].map((key) => Number(raw[key]));
  if (!Number.isInteger(page) || page < 1 || page > 5000 || nums.some((value) => !Number.isFinite(value) || value < -0.05 || value > 5)) {
    fail(400, 'INVALID_INPUT', '메모 위치가 올바르지 않습니다.');
  }
  const content = String(raw.content || '').slice(0, 4000);
  const inkPaths = Array.isArray(raw.inkPaths) ? raw.inkPaths : [];
  const inkJson = JSON.stringify(inkPaths);
  if (inkJson.length > 400_000) fail(400, 'TOO_LARGE', '필기가 너무 깁니다.');
  return {
    id,
    driveFileId: fileId,
    page,
    x: nums[0],
    y: nums[1],
    w: nums[2],
    h: nums[3],
    type,
    content,
    inkPaths,
    color: String(raw.color || '').slice(0, 20),
    status,
    version: Number(raw.version) || 1,
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
  };
}

function sameMemo(row, ann) {
  return (
    row.page === ann.page &&
    row.x === ann.x &&
    row.y === ann.y &&
    row.w === ann.w &&
    row.h === ann.h &&
    row.type === ann.type &&
    row.content === ann.content &&
    row.ink_json === JSON.stringify(ann.inkPaths || []) &&
    row.color === (ann.color || '') &&
    row.status === ann.status
  );
}

function saveMemo(store, session, ann, force) {
  const file = store.file(ann.driveFileId);
  if (!file || file.deleted) fail(404, 'NOT_FOUND', '자료를 찾을 수 없습니다.');
  const meeting = store.meeting(file.meeting_id);
  if (!meeting || meeting.hidden) fail(404, 'NOT_FOUND', '회의를 찾을 수 없습니다.');
  return store.tx(() => {
    const existing = store.memo(ann.id, session.userId);
    if (!existing) {
      const version = force ? 1 : ann.version;
      store.insertMemo(memoRow(session, file, ann, version, ann.createdAt));
      return { saved: annotationOf({ ...memoRow(session, file, ann, version, ann.createdAt), created_at: ann.createdAt, updated_at: ann.updatedAt, ink_json: JSON.stringify(ann.inkPaths || []) }, meeting, file) };
    }
    if (!force && ann.version === existing.version && sameMemo(existing, ann)) {
      return { saved: annotationOf(existing, meeting, file) };
    }
    if (!force && ann.version !== existing.version + 1) {
      return { conflict: annotationOf(existing, meeting, file) };
    }
    const version = force ? existing.version + 1 : ann.version;
    const row = memoRow(session, file, { ...ann, updatedAt: nowIso() }, version, existing.created_at);
    store.updateMemo(row);
    return { saved: annotationOf({ ...row, created_at: existing.created_at }, meeting, file) };
  });
}

function noteLogin(store, key) {
  const row = store.attempt(key);
  const fails = (row?.fails || 0) + 1;
  const lockedUntil = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
  store.putAttempt(key, fails >= MAX_FAILS ? 0 : fails, lockedUntil);
  if (lockedUntil) fail(429, 'LOCKED', '로그인을 잠시 멈췄습니다. 15분 뒤에 다시 시도해 주세요.');
}

function ensureUnlocked(store, key) {
  const row = store.attempt(key);
  if (row && row.locked_until > Date.now()) fail(429, 'LOCKED', '로그인을 잠시 멈췄습니다. 15분 뒤에 다시 시도해 주세요.');
}

function loginLocks(store) {
  const rows = [];
  for (const row of store.lockedAttempts(Date.now())) {
    if (row.key === 'user:admin') {
      rows.push({ key: row.key, kind: 'account', name: '관리자', position: '기획처', lockedUntil: row.locked_until });
      continue;
    }
    if (row.key.startsWith('user:')) {
      const officer = store.officer(row.key.slice(5));
      rows.push({
        key: row.key,
        kind: 'account',
        name: officer?.name || '알 수 없는 계정',
        position: officer?.position || '',
        lockedUntil: row.locked_until,
      });
      continue;
    }
    if (row.key.startsWith('ip:') && row.key.length <= 120) {
      rows.push({ key: row.key, kind: 'address', name: row.key.slice(3), position: '', lockedUntil: row.locked_until });
    }
  }
  return rows;
}

function adminVersion(store) {
  const value = Number(store.setting('adminSessionVersion', '1'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function adminMustChange(store) {
  return store.setting('adminMustChange', '1') === '1';
}

function ensureAdminAccount(store) {
  if (store.setting('adminPasswordHash', '')) return;
  store.tx(() => {
    if (store.setting('adminPasswordHash', '')) return;
    store.putSetting('adminPasswordHash', hashPassword(INITIAL_ADMIN_PASSWORD));
    store.putSetting('adminMustChange', '1');
    store.putSetting('adminSessionVersion', '1');
    store.dropAdminSessions();
  });
}

function employeeNoOk(value) {
  return /^[A-Za-z0-9]{4,20}$/.test(String(value || ''));
}

function saveOfficers(store, rows) {
  if (!Array.isArray(rows) || rows.length > 30) fail(400, 'INVALID_INPUT', '보직자는 30명까지 등록할 수 있습니다.');
  const seenMail = new Set();
  const seenNo = new Set();
  const stamp = nowIso();
  const ids = [];
  store.tx(() => {
    for (const raw of rows) {
      const id = String(raw.id || '');
      const position = String(raw.position || '').trim();
      const name = String(raw.name || '').trim();
      const email = String(raw.email || '').trim().toLowerCase();
      const employeeNo = String(raw.employeeNo || '').trim();
      if (!ID_RE.test(id)) fail(400, 'INVALID_INPUT', '보직자 번호가 올바르지 않습니다.');
      if (!position || position.length > 40 || name.length > 40) fail(400, 'INVALID_INPUT', '직위와 이름을 확인해 주세요.');
      if (name && !employeeNoOk(employeeNo)) fail(400, 'INVALID_INPUT', '사번은 4자 이상 20자 이하의 영문과 숫자입니다.');
      if (!name && employeeNo && !employeeNoOk(employeeNo)) fail(400, 'INVALID_INPUT', '사번은 4자 이상 20자 이하의 영문과 숫자입니다.');
      if (email && !/^[^\s@]+@yeonsung\.ac\.kr$/.test(email)) fail(400, 'INVALID_INPUT', '연성대학교 메일(@yeonsung.ac.kr)만 등록할 수 있습니다.');
      if (email && seenMail.has(email)) fail(400, 'INVALID_INPUT', '같은 메일 주소가 두 번 있습니다.');
      if (employeeNo && seenNo.has(employeeNo)) fail(400, 'INVALID_INPUT', '같은 사번이 두 번 있습니다.');
      if (email) seenMail.add(email);
      if (employeeNo) seenNo.add(employeeNo);
      const existing = store.officer(id);
      let hash = existing?.password_hash || hashPassword(employeeNo || crypto.randomBytes(12).toString('hex'));
      let mustChange = existing ? existing.must_change : 1;
      let version = existing?.session_version || 1;
      if (!existing) {
        hash = hashPassword(employeeNo || '0000');
        mustChange = 1;
      } else if (employeeNo && existing.employee_no !== employeeNo && existing.must_change === 1) {
        hash = hashPassword(employeeNo);
        version += 1;
        store.dropSessions(id);
      }
      store.saveOfficer({
        id,
        position,
        name,
        email,
        employee_no: employeeNo,
        password_hash: hash,
        must_change: mustChange,
        session_version: version,
        active: 1,
        sort_order: ids.length + 1,
        created_at: existing?.created_at || stamp,
        updated_at: stamp,
      });
      ids.push(id);
    }
    store.deactivateMissing(ids);
  });
}

function importLegacy(store, root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const parsed = parseFolderName(entry.name);
    if (!parsed) continue;
    for (const bucket of BUCKETS) {
      const dir = path.join(root, entry.name, bucket);
      let files = [];
      try {
        files = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !/\.pdf$/i.test(file.name)) continue;
        const rel = `${entry.name}/${bucket}/${file.name}`;
        if (store.fileByPath(rel)) continue;
        const id = `legacy_${parsed.dateKey}`;
        if (!store.meeting(id)) {
          const stamp = nowIso();
          store.insertMeeting({ id, dateKey: parsed.dateKey, folderDate: parsed.folderDate, time: '09:00', title: '', createdAt: stamp, updatedAt: stamp });
        }
        const full = path.join(dir, file.name);
        const bytes = fs.readFileSync(full);
        const stat = fs.statSync(full);
        store.insertFile({
          id: newId('f_'),
          meeting_id: id,
          category: bucket,
          name: file.name,
          sort_order: store.nextSort(id, bucket),
          rel_path: rel,
          size: stat.size,
          sha256: sha256(bytes),
          created_at: stat.mtime.toISOString(),
          updated_at: stat.mtime.toISOString(),
        });
      }
    }
  }
}

function autoWeekdayOf(store) {
  const value = Number(store.setting('meetingAutoWeekday', '1'));
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 1;
}

function autoTimeOf(store) {
  const time = store.setting('meetingAutoTime', '10:00');
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '10:00';
}

function runAuto(store, root) {
  const today = todayKey();
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(new Date()),
  ) % 24;
  if (store.setting('meetingAuto') === '1' && weekdayKey(today) === 1 && hour >= 13 && hour <= 20 && store.setting('autoDone') !== today) {
    store.putSetting('autoDone', today);
    const plan = autoMeetingPlan(today, autoWeekdayOf(store), autoTimeOf(store));
    if (plan && !store.meetings().some((meeting) => meeting.date_key === plan.dateKey && meeting.time === plan.time)) {
      createMeeting(store, root, plan);
      store.putSetting('meetingDate', plan.dateKey);
      store.putSetting('meetingTime', plan.time);
    }
  }
  const fixed = nextFixedMeetingDate(store.setting('meetingDate'), today);
  if (fixed) {
    createMeeting(store, root, { dateKey: fixed, time: store.setting('meetingTime', '10:00') || '10:00' });
    store.putSetting('meetingDate', fixed);
  }
}

async function composedFile(root, store, session, file) {
  const stored = readOriginal(root, file.rel_path);
  if (!stored) fail(404, 'NOT_FOUND', '원본 파일을 찾을 수 없습니다.');
  const meeting = store.meeting(file.meeting_id);
  const memos = store
    .memosFor(session.userId, file.id)
    .filter((row) => row.status === 'active')
    .map((row) => annotationOf(row, meeting, file));
  if (!memos.length) return { bytes: stored.bytes, name: file.name };
  const composed = await composePdf(stored.bytes, memos);
  return { bytes: Buffer.from(composed.bytes), name: file.name };
}

function ensureDateFolders(store, root) {
  for (const meeting of store.meetings()) {
    for (const bucket of BUCKETS) {
      const dir = resolveInside(root, storedPath(meeting.folder_date, bucket));
      if (dir) fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function createApiServer(root, options = {}) {
  const base = ensureRoot(root);
  const store = openStore(options.dbPath || defaultDbPath(base));
  ensureAdminAccount(store);
  importLegacy(store, base);
  ensureDateFolders(store, base);
  const server = http.createServer((req, res) => {
    void handle(req, res, base, store);
  });
  server.store = store;
  server.on('close', () => {
    try {
      store.close();
    } catch {
      /* already closed */
    }
  });
  return server;
}

async function handle(req, res, root, store) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  try {
    requireMutation(req);
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, data: { service: 'depthm', root: 'materials' } });
      return;
    }
    if (req.method === 'GET' && pathname === '/roster') {
      sendJson(res, 200, { ok: true, data: { officers: store.roster() } });
      return;
    }
    if (req.method === 'POST' && pathname === '/login') {
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const officerId = String(body.officerId || '');
      const ipKey = `ip:${clientIp(req)}`;
      ensureUnlocked(store, `user:${officerId}`);
      ensureUnlocked(store, ipKey);
      const officer = ID_RE.test(officerId) ? store.officer(officerId) : null;
      const usable = officer && officer.active === 1 && officer.name && officer.employee_no;
      const matches = usable ? verifyPassword(body.password, officer.password_hash) : (verifyPassword(String(body.password || ''), DUMMY_HASH), false);
      if (!matches) {
        noteLogin(store, `user:${officerId}`);
        noteLogin(store, ipKey);
        store.log({ userId: officerId || 'unknown', name: '', position: '', action: '로그인실패', target: '', at: nowIso() });
        fail(401, 'WRONG_PASSWORD', '비밀번호가 올바르지 않습니다.');
      }
      store.clearAttempt(`user:${officerId}`);
      store.clearAttempt(ipKey);
      const token = issueSession(store, req, res, {
        userId: officer.id,
        role: 'user',
        sessionVersion: officer.session_version,
        mustChange: officer.must_change === 1,
      });
      store.log({ userId: officer.id, name: officer.name, position: officer.position, action: '로그인', target: '', at: nowIso() });
      sendJson(res, 200, {
        ok: true,
        data: { userId: officer.id, name: officer.name, position: officer.position, role: 'user', mustChangePassword: officer.must_change === 1 },
      }, { 'Set-Cookie': sessionCookie(token, req) });
      return;
    }
    if (req.method === 'POST' && pathname === '/admin/login') {
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const ipKey = `ip:${clientIp(req)}`;
      ensureUnlocked(store, 'user:admin');
      ensureUnlocked(store, ipKey);
      const hash = store.setting('adminPasswordHash', '');
      const matches = hash ? verifyPassword(body.password, hash) : (verifyPassword(String(body.password || ''), DUMMY_HASH), false);
      if (!matches) {
        noteLogin(store, 'user:admin');
        noteLogin(store, ipKey);
        store.log({ userId: 'admin', name: '관리자', position: '기획처', action: '로그인실패', target: '', at: nowIso() });
        fail(401, 'WRONG_PASSWORD', '비밀번호가 올바르지 않습니다.');
      }
      store.clearAttempt('user:admin');
      store.clearAttempt(ipKey);
      const mustChange = adminMustChange(store);
      const token = issueSession(store, req, res, {
        userId: 'admin',
        role: 'admin',
        sessionVersion: adminVersion(store),
        mustChange,
      });
      store.log({ userId: 'admin', name: '관리자', position: '기획처', action: 'admin로그인', target: '', at: nowIso() });
      sendJson(res, 200, {
        ok: true,
        data: { userId: 'admin', name: '관리자', position: '기획처', role: 'admin', mustChangePassword: mustChange },
      }, { 'Set-Cookie': sessionCookie(token, req) });
      return;
    }
    if (req.method === 'POST' && pathname === '/logout') {
      const session = currentSession(store, req);
      if (session) store.deleteSession(session.tokenHash);
      sendJson(res, 200, { ok: true, data: { ok: true } }, { 'Set-Cookie': sessionCookie('', req, true) });
      return;
    }
    if (req.method === 'GET' && pathname === '/session') {
      const session = currentSession(store, req);
      if (!session) fail(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
      sendJson(res, 200, {
        ok: true,
        data: {
          userId: session.userId,
          name: session.name,
          position: session.position,
          role: session.role,
          mustChangePassword: session.mustChange,
        },
      });
      return;
    }
    if (req.method === 'POST' && pathname === '/password') {
      const session = requireUser(store, req);
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const next = String(body.newPassword || '');
      if (session.role === 'admin') {
        if (!session.mustChange && !verifyPassword(body.currentPassword, store.setting('adminPasswordHash', ''))) fail(401, 'WRONG_PASSWORD', '현재 비밀번호가 올바르지 않습니다.');
        if (next === INITIAL_ADMIN_PASSWORD) fail(400, 'INVALID_INPUT', '새 비밀번호는 admin과 달라야 합니다.');
        if (next.length < 8 || next.length > 64) fail(400, 'INVALID_INPUT', '새 비밀번호는 8자 이상 64자 이하여야 합니다.');
        const version = adminVersion(store) + 1;
        store.tx(() => {
          store.putSetting('adminPasswordHash', hashPassword(next));
          store.putSetting('adminMustChange', '0');
          store.putSetting('adminSessionVersion', String(version));
          store.dropAdminSessions();
        });
        const token = issueSession(store, req, res, { userId: 'admin', role: 'admin', sessionVersion: version, mustChange: false });
        sendJson(res, 200, { ok: true, data: { mustChangePassword: false } }, { 'Set-Cookie': sessionCookie(token, req) });
        return;
      }
      if (session.role !== 'user') fail(403, 'FORBIDDEN', '보직자 계정에서 비밀번호를 바꿉니다.');
      const officer = store.officer(session.userId);
      if (!officer || (!session.mustChange && !verifyPassword(body.currentPassword, officer.password_hash))) fail(401, 'WRONG_PASSWORD', '현재 비밀번호가 올바르지 않습니다.');
      if (next.length < 8 || next.length > 64) fail(400, 'INVALID_INPUT', '새 비밀번호는 8자 이상 64자 이하여야 합니다.');
      if (next === officer.employee_no) fail(400, 'INVALID_INPUT', '새 비밀번호는 사번과 달라야 합니다.');
      const version = officer.session_version + 1;
      store.tx(() => {
        store.saveOfficer({ ...officer, password_hash: hashPassword(next), must_change: 0, session_version: version, updated_at: nowIso() });
        store.dropSessions(officer.id);
      });
      const token = issueSession(store, req, res, { userId: officer.id, role: 'user', sessionVersion: version, mustChange: false });
      sendJson(res, 200, { ok: true, data: { mustChangePassword: false } }, { 'Set-Cookie': sessionCookie(token, req) });
      return;
    }

    const sessionReady = () => requireReady(store, req);
    if (req.method === 'GET' && pathname === '/boot') {
      sessionReady();
      sendJson(res, 200, { ok: true, data: { config: publicConfig(store), tree: treeOf(store) } });
      return;
    }
    if (req.method === 'GET' && pathname === '/tree') {
      sessionReady();
      sendJson(res, 200, { ok: true, data: treeOf(store) });
      return;
    }
    if (req.method === 'GET' && pathname === '/pulse') {
      sessionReady();
      const config = publicConfig(store);
      sendJson(res, 200, { ok: true, data: { treeRefreshAt: store.setting('treeRefreshAt', ''), changeNotices: config.changeNotices, usageTips: config.usageTips } });
      return;
    }
    if (req.method === 'GET' && (pathname === '/file' || pathname === '/meta')) {
      const session = sessionReady();
      const file = store.file(url.searchParams.get('id'));
      if (!file || file.deleted) fail(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
      const stored = readOriginal(root, file.rel_path);
      if (!stored) fail(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
      if (pathname === '/meta') {
        sendJson(res, 200, { ok: true, data: { fileId: file.id, name: file.name, modifiedTime: file.updated_at, md5Checksum: file.sha256, size: file.size } });
        return;
      }
      store.log({ userId: session.userId, name: session.name, position: session.position, action: '열람', target: file.name, at: nowIso() });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-File-Name': encodeURIComponent(file.name),
        'X-Modified': file.updated_at,
        'X-Md5': file.sha256,
        'X-Size': String(file.size),
      });
      fs.createReadStream(stored.full).pipe(res);
      return;
    }
    if (req.method === 'GET' && pathname === '/memos') {
      const session = sessionReady();
      const file = store.file(url.searchParams.get('fileId'));
      if (!file || file.deleted) fail(404, 'NOT_FOUND', '자료를 찾을 수 없습니다.');
      const meeting = store.meeting(file.meeting_id);
      const rows = store.memosFor(session.userId, file.id).map((row) => annotationOf(row, meeting, file));
      sendJson(res, 200, { ok: true, data: { annotations: rows } });
      return;
    }
    if (req.method === 'PUT' && pathname === '/memos') {
      const session = sessionReady();
      const body = JSON.parse((await readBody(req, 500_000)).toString('utf8') || '{}');
      const ann = normalizeMemo(body.annotation, String(body.annotation?.driveFileId || ''));
      const result = saveMemo(store, session, ann, body.force === true);
      if (result.conflict) {
        sendJson(res, 409, { ok: false, error: { code: 'CONFLICT', message: '다른 화면에서 이 메모를 먼저 저장했습니다.' }, data: { server: result.conflict } });
        return;
      }
      sendJson(res, 200, { ok: true, data: { annotation: result.saved } });
      return;
    }
    if (req.method === 'GET' && pathname === '/download/file') {
      const session = sessionReady();
      const file = store.file(url.searchParams.get('id'));
      if (!file || file.deleted) fail(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
      const composed = await composedFile(root, store, session, file);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
        'Content-Disposition': contentDisposition(composed.name),
      });
      res.end(composed.bytes);
      return;
    }
    if (req.method === 'GET' && pathname === '/download/meeting') {
      const session = sessionReady();
      const meeting = store.meeting(url.searchParams.get('id'));
      if (!meeting || meeting.hidden) fail(404, 'NOT_FOUND', '회의를 찾을 수 없습니다.');
      const files = store.filesFor(meeting.id);
      const entries = [];
      const used = new Set();
      for (const file of files) {
        const composed = await composedFile(root, store, session, file);
        let name = `${file.category}/${file.name}`;
        if (used.has(name)) name = `${file.category}/${file.sort_order}_${file.name}`;
        used.add(name);
        entries.push({ name, bytes: new Uint8Array(composed.bytes) });
      }
      const zip = zipPdfs(entries);
      const zipName = meetingZipName(meeting);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Cache-Control': 'no-store',
        'Content-Disposition': contentDisposition(zipName),
      });
      res.end(zip);
      return;
    }
    if (req.method === 'POST' && pathname === '/log') {
      const session = sessionReady();
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      store.log({ userId: session.userId, name: session.name, position: session.position, action: String(body.action || '').slice(0, 40), target: String(body.target || '').slice(0, 180), at: nowIso() });
      sendJson(res, 200, { ok: true, data: { ok: true } });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/home') {
      requireAdmin(store, req);
      const officers = store.officersAdmin().map((row) => ({
        id: row.id,
        position: row.position,
        name: row.name,
        email: row.email,
        employeeNo: row.employee_no,
        mustChangePassword: row.must_change === 1,
        active: row.active === 1,
      }));
      sendJson(res, 200, {
        ok: true,
        data: {
          settings: {
            rootFolderSet: true,
            rootFolderName: 'materials',
            senderEmail: '',
            aliases: [],
            mailFromName: '',
            mailFromAlias: '',
            officers,
            meetingDate: store.setting('meetingDate', ''),
            meetingTime: store.setting('meetingTime', ''),
            meetingAuto: store.setting('meetingAuto') === '1',
            meetingAutoWeekday: autoWeekdayOf(store),
            meetingAutoTime: autoTimeOf(store),
            dateFolders: meetingFolders(store),
            meetings: meetingAdmin(store),
            usageTips: publicConfig(store).usageTips,
          },
          devices: store.deviceRows().map((row) => ({
            deviceId: row.deviceId,
            name: row.name,
            position: row.position,
            firstSeen: row.firstSeen,
            lastSeen: row.lastSeen,
            browser: row.browser,
            admin: row.admin,
          })),
          access: store.recentLogs().map((row) => ({
            deviceId: row.user_id,
            name: row.name,
            folderDate: '',
            action: row.action,
            target: row.target,
            at: row.at,
          })),
        },
      });
      return;
    }
    if (req.method === 'PUT' && pathname === '/admin/officers') {
      requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 200_000)).toString('utf8') || '{}');
      saveOfficers(store, body.officers);
      sendJson(res, 200, { ok: true, data: { officers: store.officersAdmin().filter((row) => row.active === 1).map(publicOfficer) } });
      return;
    }
    const resetMatch = pathname.match(/^\/admin\/officers\/([A-Za-z0-9_-]+)\/reset-password$/);
    if (req.method === 'POST' && resetMatch) {
      requireAdmin(store, req);
      const officer = store.officer(resetMatch[1]);
      if (!officer || !officer.employee_no) fail(404, 'NOT_FOUND', '보직자를 찾을 수 없습니다.');
      const version = officer.session_version + 1;
      store.tx(() => {
        store.saveOfficer({ ...officer, password_hash: hashPassword(officer.employee_no), must_change: 1, session_version: version, updated_at: nowIso() });
        store.dropSessions(officer.id);
      });
      sendJson(res, 200, { ok: true, data: { reset: true } });
      return;
    }
    if (req.method === 'GET' && pathname === '/admin/login-locks') {
      requireAdmin(store, req);
      sendJson(res, 200, { ok: true, data: { locks: loginLocks(store) } });
      return;
    }
    if (req.method === 'POST' && pathname === '/admin/login-locks/clear') {
      const session = requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const key = String(body.key || '');
      const found = loginLocks(store).find((row) => row.key === key);
      if (!found) fail(404, 'NOT_FOUND', '잠긴 로그인을 찾을 수 없습니다.');
      store.clearAttempt(key);
      const target = found.kind === 'address' ? `접속 주소 ${found.name}` : `${found.position} ${found.name}`.trim();
      store.log({
        userId: session.userId,
        name: session.name,
        position: session.position,
        action: '잠금해제',
        target: target.slice(0, 180),
        at: nowIso(),
      });
      sendJson(res, 200, { ok: true, data: { locks: loginLocks(store) } });
      return;
    }
    if (req.method === 'POST' && pathname === '/admin/meetings') {
      requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      if (body.folderOnly) {
        const meta = parseDateKey(body.dateKey);
        if (!meta) fail(400, 'INVALID_INPUT', '회의 날짜를 선택해 주세요.');
        const existing = store.meetings().find((meeting) => meeting.date_key === meta.dateKey);
        if (existing) {
          sendJson(res, 200, {
            ok: true,
            data: { folderDate: existing.folder_date, dateKey: existing.date_key, folderId: existing.id, url: '', time: existing.time, title: existing.title, existed: true },
          });
          return;
        }
      }
      const meeting = createMeeting(store, root, body);
      if (!body.folderOnly) {
        store.putSetting('meetingDate', meeting.date_key);
        store.putSetting('meetingTime', meeting.time);
      }
      store.putSetting('treeRefreshAt', nowIso());
      sendJson(res, 200, { ok: true, data: { folderDate: meeting.folder_date, dateKey: meeting.date_key, folderId: meeting.id, url: '', time: meeting.time, title: meeting.title } });
      return;
    }
    const meetingPatch = pathname.match(/^\/admin\/meetings\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'PATCH' && meetingPatch) {
      requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const time = String(body.time || '');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'INVALID_INPUT', '회의 시간은 HH:mm 형식이어야 합니다.');
      if (!store.meeting(meetingPatch[1]) || store.meeting(meetingPatch[1]).hidden) fail(404, 'NOT_FOUND', '회의를 찾을 수 없습니다.');
      store.updateMeeting(meetingPatch[1], { time, title: String(body.title || '').trim().slice(0, 80), updatedAt: nowIso() });
      sendJson(res, 200, { ok: true, data: { id: meetingPatch[1] } });
      return;
    }
    if (req.method === 'POST' && pathname === '/admin/schedule') {
      requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      if (body.clearMeeting) {
        store.putSetting('meetingDate', '');
        store.putSetting('meetingTime', '');
      }
      if (body.meetingDate) {
        const meta = parseDateKey(body.meetingDate);
        if (!meta) fail(400, 'INVALID_INPUT', '회의 날짜를 선택해 주세요.');
        const time = String(body.meetingTime || '09:00');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'INVALID_INPUT', '회의 시간은 HH:mm 형식이어야 합니다.');
        store.putSetting('meetingDate', meta.dateKey);
        store.putSetting('meetingTime', time);
      }
      if (body.meetingAuto != null) store.putSetting('meetingAuto', body.meetingAuto === true ? '1' : '0');
      if (body.meetingAutoWeekday != null) {
        const day = Number(body.meetingAutoWeekday);
        if (!Number.isInteger(day) || day < 0 || day > 6) fail(400, 'INVALID_INPUT', '요일을 선택해 주세요.');
        store.putSetting('meetingAutoWeekday', String(day));
      }
      if (body.meetingAutoTime != null) {
        const time = String(body.meetingAutoTime || '');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'INVALID_INPUT', '회의 시간은 HH:mm 형식이어야 합니다.');
        store.putSetting('meetingAutoTime', time);
      }
      sendJson(res, 200, {
        ok: true,
        data: {
          meetingDate: store.setting('meetingDate', ''),
          meetingTime: store.setting('meetingTime', ''),
          meetingAuto: store.setting('meetingAuto') === '1',
          meetingAutoWeekday: autoWeekdayOf(store),
          meetingAutoTime: autoTimeOf(store),
        },
      });
      return;
    }
    const uploadMatch = pathname.match(/^\/admin\/meetings\/([A-Za-z0-9_-]+)\/files$/);
    if (req.method === 'POST' && uploadMatch) {
      requireAdmin(store, req);
      const meeting = store.meeting(uploadMatch[1]);
      if (!meeting || meeting.hidden) fail(404, 'NOT_FOUND', '회의를 찾을 수 없습니다.');
      let bucket = String(req.headers['x-category'] || '');
      try {
        bucket = decodeURIComponent(bucket);
      } catch {
        /* keep raw */
      }
      if (!BUCKETS.includes(bucket)) fail(400, 'INVALID_INPUT', '구분은 본문, 별첨, 규정 중 하나여야 합니다.');
      const bytes = await readBody(req, MAX_PDF_BYTES);
      assertPdf(bytes);
      const name = safePdfName(req.headers['x-file-name']);
      const rel = storedPath(meeting.folder_date, bucket, name);
      if (store.fileByPath(rel) && !store.fileByPath(rel).deleted) fail(409, 'CONFLICT', '같은 이름의 자료가 있습니다. 교체를 사용해 주세요.');
      writeOriginal(root, rel, bytes);
      const id = newId('f_');
      const stamp = nowIso();
      store.insertFile({
        id,
        meeting_id: meeting.id,
        category: bucket,
        name,
        sort_order: store.nextSort(meeting.id, bucket),
        rel_path: rel,
        size: bytes.length,
        sha256: sha256(bytes),
        created_at: stamp,
        updated_at: stamp,
      });
      store.putSetting('treeRefreshAt', stamp);
      sendJson(res, 200, { ok: true, data: { id, name, path: rel } });
      return;
    }
    const replaceMatch = pathname.match(/^\/admin\/files\/([A-Za-z0-9_-]+)\/replace$/);
    if (req.method === 'POST' && replaceMatch) {
      requireAdmin(store, req);
      const file = store.file(replaceMatch[1]);
      if (!file) fail(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
      const bytes = await readBody(req, MAX_PDF_BYTES);
      assertPdf(bytes);
      const name = req.headers['x-file-name'] ? safePdfName(req.headers['x-file-name']) : file.name;
      const meeting = store.meeting(file.meeting_id);
      const rel = storedPath(meeting.folder_date, file.category, name);
      const previous = readOriginal(root, file.rel_path);
      writeOriginal(root, rel, bytes);
      if (previous && previous.full !== resolveInside(root, rel)) fs.rmSync(previous.full, { force: true });
      const stamp = nowIso();
      store.updateFileBytes(file.id, { name, relPath: rel, size: bytes.length, sha256: sha256(bytes), updatedAt: stamp });
      store.putSetting('treeRefreshAt', stamp);
      sendJson(res, 200, { ok: true, data: { id: file.id, name } });
      return;
    }
    if (req.method === 'POST' && pathname === '/admin/folders/delete') {
      requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const meta = parseDateKey(body.dateKey);
      if (!meta) fail(400, 'INVALID_INPUT', '지울 자료 폴더의 날짜를 선택해 주세요.');
      const targets = store.meetings().filter((meeting) => meeting.date_key === meta.dateKey);
      if (!targets.length) fail(404, 'NOT_FOUND', '자료 폴더를 찾을 수 없습니다.');
      const stamp = nowIso();
      for (const meeting of targets) {
        for (const file of store.filesFor(meeting.id)) {
          const stored = readOriginal(root, file.rel_path);
          if (stored) {
            const trash = resolveInside(root, `.trash/${file.id}.pdf`);
            if (trash) {
              fs.mkdirSync(path.dirname(trash), { recursive: true });
              fs.renameSync(stored.full, trash);
            }
          }
          store.markFileDeleted(file.id, stamp);
        }
        store.hideMeeting(meeting.id, stamp);
      }
      const dir = resolveInside(root, meta.folderDate);
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      const clearedSchedule = store.setting('meetingDate', '') === meta.dateKey;
      if (clearedSchedule) {
        store.putSetting('meetingDate', '');
        store.putSetting('meetingTime', '');
      }
      store.putSetting('treeRefreshAt', stamp);
      sendJson(res, 200, {
        ok: true,
        data: { folderDate: meta.folderDate, dateKey: meta.dateKey, clearedSchedule, memosKept: true },
      });
      return;
    }
    const deleteMatch = pathname.match(/^\/admin\/files\/([A-Za-z0-9_-]+)\/delete$/);
    if (req.method === 'POST' && deleteMatch) {
      requireAdmin(store, req);
      const file = store.file(deleteMatch[1]);
      if (!file || file.deleted) fail(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
      const stored = readOriginal(root, file.rel_path);
      if (stored) {
        const trash = resolveInside(root, `.trash/${file.id}.pdf`);
        fs.mkdirSync(path.dirname(trash), { recursive: true });
        fs.renameSync(stored.full, trash);
      }
      const stamp = nowIso();
      store.markFileDeleted(file.id, stamp);
      store.putSetting('treeRefreshAt', stamp);
      sendJson(res, 200, { ok: true, data: { id: file.id, memosKept: true } });
      return;
    }
    if (req.method === 'POST' && pathname === '/admin/files/order') {
      requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 8192)).toString('utf8') || '{}');
      const ids = Array.isArray(body.fileIds) ? body.fileIds.map(String) : [];
      store.tx(() => {
        ids.forEach((id, index) => {
          if (store.file(id)) store.setSort(id, index + 1);
        });
      });
      sendJson(res, 200, { ok: true, data: { ok: true } });
      return;
    }
    if (req.method === 'POST' && pathname === '/admin/refresh') {
      requireAdmin(store, req);
      const treeRefreshAt = nowIso();
      store.putSetting('treeRefreshAt', treeRefreshAt);
      sendJson(res, 200, { ok: true, data: { treeRefreshAt } });
      return;
    }
    if (req.method === 'PUT' && pathname === '/admin/tips') {
      requireAdmin(store, req);
      const body = JSON.parse((await readBody(req, 20_000)).toString('utf8') || '{}');
      const tips = Array.isArray(body.usageTips) ? body.usageTips.map((tip) => String(tip).slice(0, 80)).slice(0, 12) : [];
      store.putSetting('usageTips', JSON.stringify(tips));
      sendJson(res, 200, { ok: true, data: { usageTips: tips } });
      return;
    }
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '요청을 찾을 수 없습니다.' } });
  } catch (error) {
    if (res.headersSent) return;
    const status = error.status || 500;
    sendJson(res, status, { ok: false, error: { code: error.code || 'INTERNAL', message: status === 500 ? '서버 오류' : error.message || '서버 오류' } });
  }
}

function publicOfficer(row) {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    email: row.email,
    employeeNo: row.employee_no,
    mustChangePassword: row.must_change === 1,
  };
}

export function startServer() {
  const root = defaultMaterialsDir();
  if (process.env.NODE_ENV === 'production') {
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.accessSync(root, fs.constants.W_OK);
    } catch {
      process.stderr.write(`자료 폴더를 쓸 수 없습니다: ${root}\n운영 환경에서는 임시 폴더로 바꾸지 않습니다.\n`);
      process.exit(1);
    }
  } else {
    ensureRoot(root);
  }
  const server = createApiServer(root);
  try {
    runAuto(server.store, root);
  } catch {
    /* 시작 직후 한 번 실패해도 서버는 연다. */
  }
  const port = Number(process.env.PORT || 8787);
  const timer = setInterval(() => {
    try {
      runAuto(server.store, root);
    } catch {
      /* 다음 분에 다시 시도한다. */
    }
  }, 60_000);
  timer.unref?.();
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`depthm ${root}\n`);
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) startServer();
