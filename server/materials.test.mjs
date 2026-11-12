import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDateFolder, listTree, storeUpload } from './materials.mjs';
import { createApiServer } from './api.mjs';

describe('materials folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depthm-materials-'));

  it('creates a yy.mm.dd folder and the three sections', () => {
    const made = createDateFolder(root, '2026-11-12');
    assert.equal(made.folderDate, '26.11.12.');
    assert.equal(made.dateKey, '2026-11-12');
    for (const name of ['본문', '별첨', '규정']) {
      assert.equal(fs.statSync(path.join(root, '26.11.12.', name)).isDirectory(), true);
    }
    createDateFolder(root, '2026-11-12');
    const tree = listTree(root);
    assert.equal(tree.folders.length, 1);
    assert.equal(tree.folders[0].folderDate, '26.11.12.');
  });

  it('stores a pdf under the date folder', () => {
    const bytes = Buffer.from('%PDF-1.4\n1 0 obj\n');
    const saved = storeUpload(root, '26.11.12.', encodeURIComponent('본문'), encodeURIComponent('안건.pdf'), bytes);
    assert.equal(saved.path, '26.11.12./본문/안건.pdf');
    const tree = listTree(root);
    const body = tree.folders[0].children.find((child) => child.name === '본문');
    assert.equal(body.children.some((child) => child.name === '안건.pdf' && child.isPdf), true);
  });

  it('rejects a meeting request without an admin session', async () => {
    process.env.DEPTHM_SCRYPT_N = '1024';
    const server = createApiServer(root, { dbPath: path.join(root, '.depthm.sqlite') });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const headers = { 'Content-Type': 'application/json', 'X-Depthm-Request': '1' };
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/admin/meetings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ dateKey: '2026-11-16', time: '10:00' }),
      });
      assert.equal(denied.status, 401);
      const session = await fetch(`http://127.0.0.1:${port}/admin/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: 'admin' }),
      });
      assert.equal(session.status, 200);
      const firstCookie = String(session.headers.get('set-cookie') || '').split(';')[0];
      const changed = await fetch(`http://127.0.0.1:${port}/password`, {
        method: 'POST',
        headers: { ...headers, Cookie: firstCookie },
        body: JSON.stringify({ currentPassword: 'admin', newPassword: 'admin-secret-1' }),
      });
      assert.equal(changed.status, 200);
      const cookie = String(changed.headers.get('set-cookie') || '').split(';')[0];
      const created = await fetch(`http://127.0.0.1:${port}/admin/meetings`, {
        method: 'POST',
        headers: { ...headers, Cookie: cookie },
        body: JSON.stringify({ dateKey: '2026-11-16', time: '10:00', title: '확대간부' }),
      });
      const json = await created.json();
      assert.equal(json.data.folderDate, '26.11.16.');
      assert.equal(fs.statSync(path.join(root, '26.11.16.', '규정')).isDirectory(), true);
      assert.equal(fs.statSync(path.join(root, '26.11.16.', '본문')).isDirectory(), true);
      assert.equal(fs.statSync(path.join(root, '26.11.16.', '별첨')).isDirectory(), true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
