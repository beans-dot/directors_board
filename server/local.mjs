import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8787;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const MATERIALS = path.join(ROOT, 'materials');
const ACCOUNTS = path.join(ROOT, 'accounts');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{2})\.(\d{1,2})\.(\d{1,2})\.?$/;
const CATEGORIES = ['본문', '별첨', '규정'];
const MAX_UPLOAD = 80 * 1024 * 1024;

const DEFAULT_OFFICERS = [
  { id: 'a1000001-0000-4000-8000-000000000001', position: '총장', name: '', email: '' },
  { id: 'a1000002-0000-4000-8000-000000000002', position: '산학부총장', name: '', email: '' },
  { id: 'a1000003-0000-4000-8000-000000000003', position: '기획처장', name: '', email: '' },
  { id: 'a1000004-0000-4000-8000-000000000004', position: '교무처장', name: '', email: '' },
  { id: 'a1000005-0000-4000-8000-000000000005', position: '입학홍보처장', name: '', email: '' },
  { id: 'a1000006-0000-4000-8000-000000000006', position: '학생취업처장', name: '', email: '' },
  { id: 'a1000007-0000-4000-8000-000000000007', position: '행정지원처장', name: '', email: '' },
];

let writeChain = Promise.resolve();

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function seoulParts(date = new Date()) {
  const map = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    map[part.type] = part.value;
  }
  if (map.hour === '24') map.hour = '00';
  return map;
}

function isoKst(date = new Date()) {
  const part = seoulParts(date);
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}+09:00`;
}

function todayFolderDate() {
  const part = seoulParts();
  return `${part.year.slice(-2)}.${part.month}.${part.day}.`;
}

function parseFolderDate(name) {
  const match = String(name || '').trim().match(DATE_RE);
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

function dateKeyToFolderDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return '';
  return parseFolderDate(`${match[1].slice(-2)}.${match[2]}.${match[3]}.`)?.folderDate || '';
}

function naturalCompare(a, b) {
  const aNum = /^\d/.test(a);
  const bNum = /^\d/.test(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  return String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' });
}

function idFor(rel) {
  return Buffer.from(rel.replace(/\\/g, '/')).toString('base64url');
}

function pathFor(id) {
  return Buffer.from(String(id || ''), 'base64url').toString('utf8').replace(/\\/g, '/');
}

function inside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function defaultConfig() {
  return {
    adminPassword: '21672167',
    tokenSecret: randomBytes(32).toString('hex'),
    officers: DEFAULT_OFFICERS,
    meetingDate: '',
    meetingTime: '',
    meetingAuto: false,
    usageTips: [],
    changeNotices: [],
    mailFromName: '보직회의 지원 시스템',
    treeRefreshAt: '',
    devices: [],
    access: [],
    sends: [],
  };
}

async function readConfig() {
  const config = { ...defaultConfig(), ...(await readJson(CONFIG_PATH, {})) };
  if (!config.tokenSecret) config.tokenSecret = randomBytes(32).toString('hex');
  if (!Array.isArray(config.officers) || config.officers.length === 0) config.officers = DEFAULT_OFFICERS;
  return config;
}

async function writeConfig(config) {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function updateConfig(mutator) {
  const run = writeChain.then(async () => {
    const config = await readConfig();
    const next = (await mutator(config)) || config;
    await writeConfig(next);
    return next;
  });
  writeChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

function publicConfig(config) {
  return {
    today: todayFolderDate(),
    maxAttachBytes: 25 * 1024 * 1024,
    allowedRecipientDomain: 'yeonsung.ac.kr',
    officers: config.officers,
    meetingDate: config.meetingDate || '',
    meetingTime: config.meetingTime || '',
    changeNotices: (config.changeNotices || []).map((item) => ({ fileId: item.fileId, path: item.path })),
    usageTips: config.usageTips || [],
  };
}

function signToken(deviceId, secret) {
  const exp = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(`${deviceId}.${exp}.1`).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return { adminToken: `${payload}.${mac}`, exp };
}

function verifyAdmin(token, deviceId, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) fail('UNAUTHORIZED', 'Admin 인증이 필요합니다.');
  const mac = createHmac('sha256', secret).update(parts[0]).digest('base64url');
  const left = Buffer.from(mac);
  const right = Buffer.from(parts[1]);
  if (left.length !== right.length || !timingSafeEqual(left, right)) fail('UNAUTHORIZED', 'Admin 인증이 만료되었습니다.');
  const raw = Buffer.from(parts[0], 'base64url').toString('utf8');
  const bits = raw.split('.');
  if (bits.length !== 3 || bits[0] !== deviceId || Number(bits[1]) < Date.now() || bits[2] !== '1') {
    fail('UNAUTHORIZED', 'Admin 인증이 만료되었습니다.');
  }
}

function assertDevice(deviceId) {
  if (!UUID_RE.test(String(deviceId || ''))) fail('INVALID_INPUT', '기기 번호가 올바르지 않습니다.');
}

async function listDateFolders() {
  let entries = [];
  try {
    entries = await readdir(MATERIALS, { withFileTypes: true });
  } catch {
    return [];
  }
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseFolderDate(entry.name);
    if (!parsed) continue;
    folders.push({
      folderDate: parsed.folderDate,
      dateKey: parsed.dateKey,
      folderId: idFor(parsed.folderDate),
      url: '',
    });
  }
  folders.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  return folders;
}

async function settingsOf(config) {
  return {
    rootFolderSet: true,
    rootFolderName: '자료',
    resultFolderSet: false,
    resultFolderName: '',
    queueFolderSet: false,
    queueFolderName: '',
    packFolderSet: false,
    packFolderName: '',
    senderEmail: '',
    aliases: [],
    mailFromName: config.mailFromName || '보직회의 지원 시스템',
    mailFromAlias: '',
    officers: config.officers,
    meetingDate: config.meetingDate || '',
    meetingTime: config.meetingTime || '',
    meetingAuto: config.meetingAuto === true,
    dateFolders: await listDateFolders(),
    usageTips: config.usageTips || [],
  };
}

const md5Cache = new Map();

async function fileMd5(full, info) {
  const key = `${full}:${info.mtimeMs}:${info.size}`;
  const cached = md5Cache.get(key);
  if (cached) return cached;
  const hash = createHash('md5').update(await readFile(full)).digest('hex');
  md5Cache.set(key, hash);
  return hash;
}

async function childNodes(dir, parentPath) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = await childNodes(full, rel);
      if (!children.length) continue;
      const info = await stat(full);
      nodes.push({
        id: idFor(rel),
        name: entry.name,
        kind: 'folder',
        mimeType: 'folder',
        isPdf: false,
        modifiedTime: isoKst(info.mtime),
        md5Checksum: '',
        size: 0,
        path: rel,
        children,
      });
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
    const info = await stat(full);
    nodes.push({
      id: idFor(rel),
      name: entry.name,
      kind: 'file',
      mimeType: 'application/pdf',
      isPdf: true,
      modifiedTime: isoKst(info.mtime),
      md5Checksum: await fileMd5(full, info),
      size: info.size,
      path: rel,
    });
  }
  nodes.sort((a, b) => naturalCompare(a.name, b.name));
  return nodes;
}

async function loadTree() {
  const folders = [];
  let entries = [];
  try {
    entries = await readdir(MATERIALS, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseFolderDate(entry.name);
    if (!parsed) continue;
    const full = path.join(MATERIALS, entry.name);
    const children = await childNodes(full, parsed.folderDate);
    if (!children.length) continue;
    const info = await stat(full);
    folders.push({
      id: idFor(parsed.folderDate),
      name: parsed.folderDate,
      kind: 'folder',
      mimeType: 'folder',
      isPdf: false,
      modifiedTime: isoKst(info.mtime),
      md5Checksum: '',
      size: 0,
      path: parsed.folderDate,
      folderDate: parsed.folderDate,
      dateKey: parsed.dateKey,
      children,
    });
  }
  folders.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  return { fetchedAt: isoKst(), folders };
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

async function ensureDateFolder(folderDate) {
  const dir = path.join(MATERIALS, folderDate);
  if (!inside(MATERIALS, dir)) fail('INVALID_INPUT', '날짜 폴더 이름이 올바르지 않습니다.');
  for (const category of CATEGORIES) await mkdir(path.join(dir, category), { recursive: true });
  return dir;
}

function normalizeOfficers(input) {
  if (!Array.isArray(input)) fail('INVALID_INPUT', '보직자 목록 형식이 올바르지 않습니다.');
  if (input.length > 30) fail('INVALID_INPUT', '보직자는 30명까지 등록할 수 있습니다.');
  const seenEmail = new Set();
  const seenId = new Set();
  return input.map((row) => {
    const position = String(row?.position || '').trim();
    const name = String(row?.name || '').trim();
    const email = String(row?.email || '').trim().toLowerCase();
    if (!position || position.length > 40) fail('INVALID_INPUT', '직위를 40자 이내로 입력해 주세요.');
    if (name.length > 40) fail('INVALID_INPUT', '이름은 40자 이내로 입력해 주세요.');
    if (email && !/^[^\s@]+@yeonsung\.ac\.kr$/i.test(email)) {
      fail('INVALID_INPUT', '연성대학교 메일(@yeonsung.ac.kr)만 등록할 수 있습니다.');
    }
    let id = String(row?.id || '');
    if (!UUID_RE.test(id) || seenId.has(id)) id = randomUUID();
    seenId.add(id);
    if (email) {
      if (seenEmail.has(email)) fail('INVALID_INPUT', '같은 메일 주소가 두 번 있습니다.');
      seenEmail.add(email);
    }
    return { id, position, name, email };
  });
}

function safePdfName(name) {
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!base.toLowerCase().endsWith('.pdf') || base.length > 180) fail('NOT_PDF', 'PDF만 올릴 수 있습니다.');
  return base;
}

async function saveAccount(deviceId, profile) {
  const file = path.join(ACCOUNTS, `${deviceId}.json`);
  const current = await readJson(file, { deviceId, annotations: [] });
  current.deviceId = deviceId;
  current.name = profile.name || current.name || '';
  current.position = profile.position || current.position || '';
  current.officerId = profile.officerId || current.officerId || '';
  current.annotations = Array.isArray(current.annotations) ? current.annotations : [];
  await writeFile(file, JSON.stringify(current, null, 2));
}

function touchDevice(config, deviceId, profile = {}) {
  const now = isoKst();
  const devices = Array.isArray(config.devices) ? config.devices : [];
  let row = devices.find((item) => item.deviceId === deviceId);
  if (!row) {
    row = {
      deviceId,
      name: profile.name || '',
      position: profile.position || '',
      firstSeen: now,
      lastSeen: now,
      browser: profile.userAgent || '',
      admin: 'N',
    };
    devices.push(row);
  } else {
    row.lastSeen = now;
    if (profile.name) row.name = profile.name;
    if (profile.position) row.position = profile.position;
    if (profile.userAgent) row.browser = profile.userAgent;
  }
  config.devices = devices.slice(-500);
  return row;
}

async function handleAction(reqBody) {
  const action = String(reqBody.action || '');
  const deviceId = String(reqBody.deviceId || '');
  assertDevice(deviceId);
  const payload = reqBody.payload || {};
  const config = await readConfig();
  const adminActions = new Set(['setConfig', 'logs', 'requestTreeRefresh', 'setChangeNotice']);
  if (adminActions.has(action)) verifyAdmin(reqBody.adminToken, deviceId, config.tokenSecret);

  if (action === 'config') return publicConfig(config);
  if (action === 'boot') {
    const tree = await loadTree();
    tree.treeRefreshAt = config.treeRefreshAt || '';
    return { config: publicConfig(config), tree };
  }
  if (action === 'tree') {
    const tree = await loadTree();
    tree.treeRefreshAt = config.treeRefreshAt || '';
    return tree;
  }
  if (action === 'pulse') {
    return { treeRefreshAt: config.treeRefreshAt || '', changeNotices: publicConfig(config).changeNotices };
  }
  if (action === 'file' || action === 'fileMeta') {
    const tree = await loadTree();
    const node = findNode(tree.folders, String(payload.fileId || ''));
    if (!node || !node.isPdf) fail('NOT_FOUND', '파일을 찾을 수 없습니다.');
    if (action === 'fileMeta') {
      return {
        fileId: node.id,
        name: node.name,
        modifiedTime: node.modifiedTime,
        md5Checksum: node.md5Checksum,
        size: node.size,
      };
    }
    const full = path.join(MATERIALS, ...node.path.split('/'));
    if (!inside(MATERIALS, full)) fail('NOT_FOUND', '파일을 찾을 수 없습니다.');
    const bytes = await readFile(full);
    return {
      fileId: node.id,
      name: node.name,
      mimeType: 'application/pdf',
      modifiedTime: node.modifiedTime,
      md5Checksum: node.md5Checksum,
      size: bytes.length,
      base64: bytes.toString('base64'),
    };
  }
  if (action === 'register') {
    await updateConfig((next) => {
      touchDevice(next, deviceId, payload);
      return next;
    });
    await saveAccount(deviceId, payload);
    return { ok: true };
  }
  if (action === 'log') {
    await updateConfig((next) => {
      const events = Array.isArray(payload.events) ? payload.events : [];
      const access = Array.isArray(next.access) ? next.access : [];
      for (const event of events) {
        access.push({
          deviceId,
          name: '',
          folderDate: event.folderDate || '',
          action: event.action || '',
          target: event.target || '',
          at: event.at || isoKst(),
        });
      }
      next.access = access.slice(-1000);
      return next;
    });
    return { ok: true };
  }
  if (action === 'adminLogin') {
    const password = String(payload.password || '');
    const expected = String(config.adminPassword || '');
    if (!expected) fail('CONFIG_MISSING', 'Admin 비밀번호가 설정되지 않았습니다.');
    const left = Buffer.from(password);
    const right = Buffer.from(expected);
    const same = left.length === right.length && timingSafeEqual(left, right);
    if (!same) fail('WRONG_PASSWORD', '비밀번호가 올바르지 않습니다.');
    await updateConfig((next) => {
      const row = touchDevice(next, deviceId, { name: '관리자', position: '기획처' });
      row.admin = 'Y';
      row.name = '관리자';
      return next;
    });
    return signToken(deviceId, config.tokenSecret);
  }
  if (action === 'requestTreeRefresh') {
    const at = isoKst();
    await updateConfig((next) => {
      next.treeRefreshAt = at;
      return next;
    });
    return { treeRefreshAt: at };
  }
  if (action === 'setChangeNotice') {
    const fileId = String(payload.fileId || '');
    const noticePath = String(payload.path || '').trim();
    const enabled = !(payload.enabled === false || payload.enabled === 0 || payload.enabled === '0');
    if (!fileId || !noticePath) fail('INVALID_INPUT', '파일을 지정해 주세요.');
    const tree = await loadTree();
    const node = findNode(tree.folders, fileId);
    if (!node?.isPdf) fail('NOT_PDF', 'PDF만 변경 알림을 켤 수 있습니다.');
    const notices = (config.changeNotices || []).filter((item) => item.fileId !== fileId && item.path !== noticePath);
    if (enabled) notices.push({ fileId, path: noticePath, at: isoKst() });
    await updateConfig((next) => {
      next.changeNotices = notices;
      return next;
    });
    return { changeNotices: notices.map((item) => ({ fileId: item.fileId, path: item.path })) };
  }
  if (action === 'logs') {
    if (payload.type === 'devices') return { rows: config.devices || [] };
    if (payload.type === 'access') return { rows: [...(config.access || [])].reverse() };
    if (payload.type === 'send') return { rows: [...(config.sends || [])].reverse() };
    if (payload.type === 'settings') return { rows: [], settings: await settingsOf(config) };
    fail('INVALID_INPUT', '조회 종류가 올바르지 않습니다.');
  }
  if (action === 'setConfig') {
    if (payload.rootFolder || payload.resultFolder || payload.queueFolder || payload.packFolder) {
      fail('INVALID_INPUT', '자료는 서버의 data/materials 폴더에 올립니다. Drive 주소는 쓰지 않습니다.');
    }
    const next = await updateConfig((draft) => {
      if (payload.officers != null) draft.officers = normalizeOfficers(payload.officers);
      if (payload.clearMeeting) {
        draft.meetingDate = '';
        draft.meetingTime = '';
      }
      if (payload.meetingDate) {
        const folderDate = dateKeyToFolderDate(String(payload.meetingDate));
        if (!folderDate) fail('INVALID_INPUT', '회의 날짜가 올바르지 않습니다.');
        const time = String(payload.meetingTime || '');
        if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('INVALID_INPUT', '회의 시간이 올바르지 않습니다.');
        draft.meetingDate = String(payload.meetingDate);
        draft.meetingTime = time;
      }
      if (payload.meetingAuto != null) draft.meetingAuto = payload.meetingAuto === true;
      if (payload.usageTips != null) {
        if (!Array.isArray(payload.usageTips)) fail('INVALID_INPUT', '사용 Tip 형식이 올바르지 않습니다.');
        draft.usageTips = payload.usageTips.map((tip) => String(tip || '').trim()).filter(Boolean).slice(0, 20);
      }
      if (payload.mailFromName != null) draft.mailFromName = String(payload.mailFromName).trim().slice(0, 40);
      if (payload.mailFromAlias) fail('INVALID_INPUT', '로컬 서버에는 메일 별칭이 없습니다.');
      return draft;
    });
    if (payload.meetingDate) await ensureDateFolder(dateKeyToFolderDate(String(payload.meetingDate)));
    const settings = await settingsOf(next);
    return {
      ...settings,
      meetingFolder: settings.dateFolders.find((folder) => folder.dateKey === next.meetingDate) || null,
    };
  }
  if (action === 'send' || action === 'stage' || action === 'materialZip' || action === 'sendStatus') {
    fail('INVALID_ACTION', '메일 발송은 아직 이 서버에서 하지 않습니다.');
  }
  fail('INVALID_ACTION', '알 수 없는 요청');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('요청이 너무 큽니다.'), { code: 'INVALID_INPUT' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  body.serverTime = isoKst();
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Admin-Token, X-Folder-Date, X-Category, X-File-Name',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function publicError(error) {
  if (error?.code) return { ok: false, error: { code: error.code, message: error.message } };
  return { ok: false, error: { code: 'INTERNAL', message: String(error?.message || error).slice(0, 240) } };
}

async function handleUpload(req, res) {
  const deviceId = String(req.headers['x-device-id'] || '');
  const folderDate = decodeURIComponent(String(req.headers['x-folder-date'] || ''));
  const category = decodeURIComponent(String(req.headers['x-category'] || ''));
  const fileName = safePdfName(decodeURIComponent(String(req.headers['x-file-name'] || '')));
  assertDevice(deviceId);
  const parsed = parseFolderDate(folderDate);
  if (!parsed) fail('INVALID_INPUT', '날짜 폴더를 먼저 만들어 주세요.');
  if (!CATEGORIES.includes(category)) fail('INVALID_INPUT', '본문, 별첨, 규정 중 하나를 선택해 주세요.');
  const config = await readConfig();
  verifyAdmin(req.headers['x-admin-token'], deviceId, config.tokenSecret);
  const bytes = await readBody(req, MAX_UPLOAD);
  if (!bytes.length) fail('INVALID_INPUT', '빈 파일은 올릴 수 없습니다.');
  await ensureDateFolder(parsed.folderDate);
  const full = path.join(MATERIALS, parsed.folderDate, category, fileName);
  if (!inside(MATERIALS, full)) fail('INVALID_INPUT', '파일 이름이 올바르지 않습니다.');
  await writeFile(full, bytes);
  sendJson(res, 200, { ok: true, data: { name: fileName, path: `${parsed.folderDate}/${category}/${fileName}` } });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Admin-Token, X-Folder-Date, X-Category, X-File-Name',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (req.method === 'POST' && url.pathname === '/upload') {
      await handleUpload(req, res);
      return;
    }
    if (req.method === 'GET' && url.searchParams.get('action') === 'file') {
      const data = await handleAction({
        action: 'file',
        deviceId: url.searchParams.get('deviceId'),
        payload: { fileId: url.searchParams.get('fileId') },
      });
      const meta = {
        fileId: data.fileId,
        name: data.name,
        mimeType: 'application/pdf',
        modifiedTime: data.modifiedTime,
        md5Checksum: data.md5Checksum,
        size: data.size,
      };
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(`BOJIKPDF1\n${JSON.stringify(meta)}\n${data.base64}`);
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, data: { service: 'bojik-local', version: '0.12.0' } });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'INVALID_ACTION', message: '지원하지 않는 요청입니다.' } });
      return;
    }
    const raw = await readBody(req, 2 * 1024 * 1024);
    let body;
    try {
      body = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      sendJson(res, 400, { ok: false, error: { code: 'INVALID_INPUT', message: '요청 형식 오류' } });
      return;
    }
    if (body.action === 'file') {
      const data = await handleAction(body);
      const meta = {
        fileId: data.fileId,
        name: data.name,
        mimeType: 'application/pdf',
        modifiedTime: data.modifiedTime,
        md5Checksum: data.md5Checksum,
        size: data.size,
      };
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(`BOJIKPDF1\n${JSON.stringify(meta)}\n${data.base64}`);
      return;
    }
    const data = await handleAction(body);
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    if (!res.headersSent) sendJson(res, 200, publicError(error));
  }
});

await mkdir(MATERIALS, { recursive: true });
await mkdir(ACCOUNTS, { recursive: true });
const created = await readJson(CONFIG_PATH, null);
if (!created) await writeConfig(defaultConfig());
else await writeConfig(await readConfig());

server.listen(PORT, '::', () => {
  console.log(`local data  http://127.0.0.1:${PORT}/`);
  console.log(`materials   ${MATERIALS}`);
  console.log(`accounts    ${ACCOUNTS}`);
});
