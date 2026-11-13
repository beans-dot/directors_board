import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS officers (
  id TEXT PRIMARY KEY,
  position TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  employee_no TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  session_version INTEGER NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 0,
  admin_tag TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,
  folder_date TEXT NOT NULL,
  time TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  rel_path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  ink_json TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memos_user_file ON memos(user_id, file_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
`;

export function hashPassword(password) {
  const n = Number(process.env.DEPTHM_SCRYPT_N || 16384);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${n}:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  if (!Number.isFinite(n) || n < 2) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], 'base64url');
    expected = Buffer.from(parts[3], 'base64url');
  } catch {
    return false;
  }
  if (!salt.length || expected.length !== 32) return false;
  const actual = crypto.scryptSync(String(password), salt, 32, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, expected);
}

export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ensureOfficerSort(db) {
  const columns = db.prepare('PRAGMA table_info(officers)').all();
  if (columns.some((column) => column.name === 'sort_order')) return;
  db.exec('ALTER TABLE officers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  const rows = db.prepare('SELECT id FROM officers ORDER BY position, name').all();
  const update = db.prepare('UPDATE officers SET sort_order = ? WHERE id = ?');
  rows.forEach((row, index) => update.run(index + 1, row.id));
}

export function openStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  ensureOfficerSort(db);
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    /* Windows does not use POSIX modes. */
  }
  return new Store(db);
}

export class Store {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* already closed */
      }
      throw error;
    }
  }

  setting(key, fallback = '') {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  putSetting(key, value) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }

  log(entry) {
    this.db
      .prepare('INSERT INTO access_log (user_id, name, position, action, target, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(entry.userId, entry.name, entry.position || '', entry.action, entry.target || '', entry.at);
  }

  recentLogs(limit = 200) {
    return this.db
      .prepare('SELECT user_id, name, position, action, target, at FROM access_log ORDER BY id DESC LIMIT ?')
      .all(limit);
  }

  deviceRows() {
    return this.db
      .prepare(
        `SELECT user_id AS deviceId, name, position,
                MIN(at) AS firstSeen, MAX(at) AS lastSeen,
                '' AS browser,
                CASE WHEN user_id = 'admin' THEN '예' ELSE '' END AS admin
         FROM access_log GROUP BY user_id ORDER BY lastSeen DESC LIMIT 100`,
      )
      .all();
  }

  attempt(key) {
    return this.db.prepare('SELECT fails, locked_until FROM login_attempts WHERE key = ?').get(key) || null;
  }

  putAttempt(key, fails, lockedUntil) {
    this.db
      .prepare('INSERT INTO login_attempts (key, fails, locked_until) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until')
      .run(key, fails, lockedUntil);
  }

  clearAttempt(key) {
    this.db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
  }

  lockedAttempts(now) {
    return this.db.prepare('SELECT key, locked_until FROM login_attempts WHERE locked_until > ? ORDER BY locked_until ASC').all(now);
  }

  officer(id) {
    return this.db.prepare('SELECT * FROM officers WHERE id = ?').get(id) || null;
  }

  roster() {
    return this.db
      .prepare("SELECT id, position, name FROM officers WHERE active = 1 AND name <> '' AND position <> '' ORDER BY sort_order, position, name")
      .all();
  }

  officersAdmin() {
    return this.db
      .prepare('SELECT id, position, name, email, employee_no, must_change, active FROM officers WHERE active = 1 ORDER BY sort_order, position, name')
      .all();
  }

  saveOfficer(row) {
    this.db
      .prepare(
        `INSERT INTO officers (id, position, name, email, employee_no, password_hash, must_change, session_version, active, sort_order, created_at, updated_at)
         VALUES (@id, @position, @name, @email, @employee_no, @password_hash, @must_change, @session_version, @active, @sort_order, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           position = excluded.position,
           name = excluded.name,
           email = excluded.email,
           employee_no = excluded.employee_no,
           password_hash = excluded.password_hash,
           must_change = excluded.must_change,
           session_version = excluded.session_version,
           active = excluded.active,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at`,
      )
      .run(row);
  }

  deactivateMissing(ids) {
    if (!ids.length) {
      this.db.prepare('UPDATE officers SET active = 0').run();
      return;
    }
    const marks = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE officers SET active = 0 WHERE id NOT IN (${marks})`).run(...ids);
  }

  dropSessions(userId) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  putSession(row) {
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, role, session_version, must_change, admin_tag, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(row.tokenHash, row.userId, row.role, row.sessionVersion, row.mustChange ? 1 : 0, row.adminTag || '', row.expiresAt, row.createdAt);
  }

  session(tokenHash) {
    return this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) || null;
  }

  deleteSession(tokenHash) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  touchSession(tokenHash, expiresAt, mustChange) {
    this.db.prepare('UPDATE sessions SET expires_at = ?, must_change = ? WHERE token_hash = ?').run(expiresAt, mustChange ? 1 : 0, tokenHash);
  }

  dropAdminSessions() {
    this.db.prepare("DELETE FROM sessions WHERE role = 'admin'").run();
  }

  meetings() {
    return this.db.prepare('SELECT * FROM meetings WHERE hidden = 0 ORDER BY date_key, time, created_at').all();
  }

  meeting(id) {
    return this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) || null;
  }

  meetingByPath(relPath) {
    return this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(relPath) || null;
  }

  insertMeeting(row) {
    this.db
      .prepare(
        'INSERT INTO meetings (id, date_key, folder_date, time, title, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      )
      .run(row.id, row.dateKey, row.folderDate, row.time, row.title || '', row.createdAt, row.updatedAt);
  }

  updateMeeting(id, fields) {
    this.db
      .prepare('UPDATE meetings SET time = ?, title = ?, updated_at = ? WHERE id = ? AND hidden = 0')
      .run(fields.time, fields.title, fields.updatedAt, id);
  }

  hideMeeting(id, updatedAt) {
    this.db.prepare('UPDATE meetings SET hidden = 1, updated_at = ? WHERE id = ? AND hidden = 0').run(updatedAt, id);
  }

  filesFor(meetingId, includeDeleted = false) {
    const sql = includeDeleted
      ? 'SELECT * FROM files WHERE meeting_id = ? ORDER BY sort_order, name'
      : 'SELECT * FROM files WHERE meeting_id = ? AND deleted = 0 ORDER BY sort_order, name';
    return this.db.prepare(sql).all(meetingId);
  }

  file(id) {
    return this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) || null;
  }

  fileByPath(rel) {
    return this.db.prepare('SELECT * FROM files WHERE rel_path = ?').get(rel) || null;
  }

  nextSort(meetingId, category) {
    const row = this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM files WHERE meeting_id = ? AND category = ? AND deleted = 0').get(meetingId, category);
    return Number(row?.n || 0) + 1;
  }

  insertFile(row) {
    this.db
      .prepare(
        `INSERT INTO files (id, meeting_id, category, name, sort_order, rel_path, size, sha256, deleted, created_at, updated_at)
         VALUES (@id, @meeting_id, @category, @name, @sort_order, @rel_path, @size, @sha256, 0, @created_at, @updated_at)`,
      )
      .run(row);
  }

  updateFileBytes(id, fields) {
    this.db
      .prepare('UPDATE files SET name = ?, rel_path = ?, size = ?, sha256 = ?, updated_at = ?, deleted = 0 WHERE id = ?')
      .run(fields.name, fields.relPath, fields.size, fields.sha256, fields.updatedAt, id);
  }

  markFileDeleted(id, updatedAt) {
    this.db.prepare('UPDATE files SET deleted = 1, updated_at = ? WHERE id = ?').run(updatedAt, id);
  }

  setSort(id, sortOrder) {
    this.db.prepare('UPDATE files SET sort_order = ? WHERE id = ?').run(sortOrder, id);
  }

  memo(id, userId) {
    return this.db.prepare('SELECT * FROM memos WHERE id = ? AND user_id = ?').get(id, userId) || null;
  }

  memosFor(userId, fileId) {
    return this.db.prepare('SELECT * FROM memos WHERE user_id = ? AND file_id = ? ORDER BY created_at, id').all(userId, fileId);
  }

  insertMemo(row) {
    this.db
      .prepare(
        `INSERT INTO memos (id, user_id, meeting_id, file_id, page, x, y, w, h, type, content, ink_json, color, status, version, created_at, updated_at)
         VALUES (@id, @user_id, @meeting_id, @file_id, @page, @x, @y, @w, @h, @type, @content, @ink_json, @color, @status, @version, @created_at, @updated_at)`,
      )
      .run(row);
  }

  updateMemo(row) {
    this.db
      .prepare(
        `UPDATE memos SET page=@page, x=@x, y=@y, w=@w, h=@h, type=@type, content=@content, ink_json=@ink_json, color=@color, status=@status, version=@version, updated_at=@updated_at
         WHERE id=@id AND user_id=@user_id`,
      )
      .run({
        page: row.page,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        type: row.type,
        content: row.content,
        ink_json: row.ink_json,
        color: row.color,
        status: row.status,
        version: row.version,
        updated_at: row.updated_at,
        id: row.id,
        user_id: row.user_id,
      });
  }
}
