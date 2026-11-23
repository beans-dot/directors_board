import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from './api.mjs';
import { openStore } from './db.mjs';

async function start(root) {
  const server = createApiServer(root, { dbPath: path.join(root, '.depthm.sqlite') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'X-Depthm-Request': '1' } });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const request = async (method, url, body, auth = cookie) => {
    const response = await fetch(`${base}${url}`, { method, headers: {
      'Content-Type': 'application/json', 'X-Depthm-Request': '1', Cookie: auth,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const upload = async (meetingId, name, category = '별첨', replaceId) => {
    const response = await fetch(`${base}/admin/${replaceId ? `files/${replaceId}/replace` : `meetings/${meetingId}/files`}`, {
      method: 'POST', headers: { 'X-Depthm-Request': '1', Cookie: cookie,
        'X-Category': encodeURIComponent(category), 'X-File-Name': encodeURIComponent(name) },
      body: Buffer.from('%PDF-1.4\nfixture'),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.data.id;
  };
  return { server, request, upload };
}

it('sorts new attachments by bracketed office and number, then preserves manual order across uploads and restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depthm-order-flow-'));
  let app = await start(root);
  try {
    const meeting = await app.request('POST', '/admin/meetings', { dateKey: '2026-11-23', time: '10:00' });
    const id = meeting.data.folderId;
    const names = ['[행정] 총무.pdf', '[산학 별첨1] 현황.pdf', '[학생 별첨1] 2026.pdf', '[입학 별첨1] 모집.pdf',
      '[교무처 별첨10] 평가.pdf', '[교무처 별첨2] 평가.pdf', '[기획 별첨1] 계획.pdf', '기타.pdf'];
    const ids = new Map();
    for (const name of names) ids.set(name, await app.upload(id, name));
    const expected = [names[6], names[5], names[4], names[3], names[2], names[1], names[0], names[7]];
    const home = await app.request('GET', '/admin/home');
    assert.deepEqual(home.data.settings.meetings[0].files.map((file) => file.name), expected);
    const tree = await app.request('GET', '/tree');
    const attachments = tree.data.folders[0].children.find((node) => node.name === '별첨').children;
    assert.deepEqual(attachments.map((file) => file.name), expected);
    assert.deepEqual(attachments.map((file) => file.sortOrder), [1, 2, 3, 4, 5, 6, 7, 8]);
    const manual = expected.slice().reverse().map((name) => ids.get(name));
    assert.equal((await app.request('POST', '/admin/files/order', { fileIds: [manual[0], manual[0]] })).status, 400);
    assert.equal((await app.request('POST', '/admin/files/order', { fileIds: manual })).status, 200);
    const after = await app.upload(id, '[기획 별첨0] 나중에 추가.pdf');
    assert.deepEqual(app.server.store.filesFor(id).map((file) => file.id), [...manual, after]);
    await app.upload(id, '[기획 별첨99] 교체한 제목.pdf', '별첨', manual[1]);
    await new Promise((resolve) => app.server.close(resolve));
    app = await start(root);
    assert.deepEqual(app.server.store.filesFor(id).map((file) => file.id), [...manual, after]);
    const extra = await app.upload(id, '[교무] 추가.pdf');
    assert.deepEqual(app.server.store.filesFor(id).map((file) => file.id), [...manual, after, extra]);
    const newMeeting = await app.request('POST', '/admin/meetings', { dateKey: '2026-11-24', time: '10:00' });
    await app.upload(newMeeting.data.folderId, '[행정] 뒤.pdf');
    await app.upload(newMeeting.data.folderId, '자료 [기획] 앞.pdf');
    assert.deepEqual(app.server.store.filesFor(newMeeting.data.folderId).map((file) => file.name), ['자료 [기획] 앞.pdf', '[행정] 뒤.pdf']);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

it('saves change notices for all sessions, survives restart and follows replacements and deletions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depthm-notice-flow-'));
  let app = await start(root);
  try {
    const meeting = await app.request('POST', '/admin/meetings', { dateKey: '2026-11-23', time: '10:00' });
    const meetingId = meeting.data.folderId;
    const fileId = await app.upload(meetingId, '[교무] 평가.pdf');
    const url = `/admin/files/${fileId}/change-notice`;
    assert.equal((await app.request('PUT', url, { enabled: true }, '')).status, 401);
    await app.request('PUT', '/admin/officers', { officers: [{ id: 'user_notice111', name: '테스트', position: '교무처장' }] });
    const loginResponse = await fetch(`http://127.0.0.1:${app.server.address().port}/login`, { method: 'POST',
      headers: { 'X-Depthm-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ officerId: 'user_notice111' }) });
    const userCookie = loginResponse.headers.get('set-cookie').split(';')[0];
    assert.equal((await app.request('PUT', url, { enabled: true }, userCookie)).status, 403);
    assert.equal((await app.request('PUT', url, { enabled: 'true' })).status, 400);
    assert.equal((await app.request('PUT', url, { enabled: true })).status, 200);
    await app.request('PUT', url, { enabled: true });
    const notices = [{ fileId, path: '26.11.23./별첨/[교무] 평가.pdf' }];
    assert.deepEqual((await app.request('GET', '/pulse', undefined, userCookie)).data.changeNotices, notices);
    assert.deepEqual((await app.request('GET', '/admin/home')).data.settings.changeNotices, notices);
    await new Promise((resolve) => app.server.close(resolve));
    app = await start(root);
    assert.deepEqual((await app.request('GET', '/boot')).data.config.changeNotices, notices);
    await app.upload(meetingId, '[교무] 평가 수정.pdf', '별첨', fileId);
    assert.deepEqual((await app.request('GET', '/pulse')).data.changeNotices, [{ fileId, path: '26.11.23./별첨/[교무] 평가 수정.pdf' }]);
    await app.request('PUT', url, { enabled: false });
    assert.deepEqual((await app.request('GET', '/pulse')).data.changeNotices, []);
    await app.request('PUT', url, { enabled: true });
    await app.request('POST', `/admin/files/${fileId}/delete`);
    assert.deepEqual((await app.request('GET', '/pulse')).data.changeNotices, []);
    assert.equal((await app.request('PUT', url, { enabled: true })).status, 404);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

it('preserves pre-upgrade file order when old databases do not record manual sorting', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depthm-legacy-order-'));
  const store = openStore(path.join(root, '.depthm.sqlite'));
  const stamp = new Date().toISOString();
  store.insertMeeting({ id: 'm_legacy1', dateKey: '2026-11-23', folderDate: '26.11.23.', time: '10:00', createdAt: stamp, updatedAt: stamp });
  for (const [index, name] of ['[행정] 기존.pdf', '[기획] 기존.pdf'].entries()) {
    store.insertFile({ id: `f_legacy${index}`, meeting_id: 'm_legacy1', category: '별첨', name, sort_order: index + 1,
      rel_path: `26.11.23./별첨/${name}`, size: 12, sha256: '', created_at: stamp, updated_at: stamp });
  }
  store.close();
  const app = await start(root);
  try {
    await app.upload('m_legacy1', '[교무] 새 자료.pdf');
    assert.deepEqual(app.server.store.filesFor('m_legacy1').map((file) => file.name), ['[행정] 기존.pdf', '[기획] 기존.pdf', '[교무] 새 자료.pdf']);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
