import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultDbPath, defaultMaterialsDir } from './materials.mjs';

const root = defaultMaterialsDir();
const dbPath = defaultDbPath(root);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.resolve(process.argv[2] || path.join(path.dirname(dbPath), 'backups', stamp));
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(root, path.join(dest, 'materials'), { recursive: true });
const db = new DatabaseSync(dbPath, { readOnly: true });
const snapshot = path.join(dest, 'depthm.sqlite').replaceAll("'", "''");
db.exec(`VACUUM INTO '${snapshot}'`);
db.close();
process.stdout.write(`backup ${dest}\n`);
