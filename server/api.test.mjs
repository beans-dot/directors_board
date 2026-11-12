import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.DEPTHM_SCRYPT_N = '1024';

const { createApiServer } = await import('./api.mjs');
const { PDFDocument, StandardFonts } = await import('pdf-lib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depthm-api-'));
const dbPath = path.join(root, '.depthm.sqlite');

function headers(cookie = '') {
  return {
    'Content-Type': 'application/json',
    'X-Depthm-Request': '1',
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function json(port, method, pathname, body, cookie = '') {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: headers(cookie),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload, cookie: response.headers.get('set-cookie') || '' };
}

function cookieOf(header) {
  return String(header).split(';')[0];
}

async function becomeAdmin(port) {
  const login = await json(port, 'POST', '/admin/login', { password: 'admin' });
  assert.equal(login.status, 200);
  assert.equal(login.payload.data.mustChangePassword, true);
  const blocked = await json(port, 'GET', '/admin/home', null, cookieOf(login.cookie));
  assert.equal(blocked.status, 403);
  const same = await json(port, 'POST', '/password', { currentPassword: 'admin', newPassword: 'admin' }, cookieOf(login.cookie));
  assert.equal(same.status, 400);
  const changed = await json(port, 'POST', '/password', { newPassword: 'admin-secret-1' }, cookieOf(login.cookie));
  assert.equal(changed.status, 200);
  assert.equal(changed.payload.data.mustChangePassword, false);
  const missingCurrent = await json(port, 'POST', '/password', { newPassword: 'admin-secret-2' }, cookieOf(changed.cookie));
  assert.equal(missingCurrent.status, 401);
  const stale = await json(port, 'POST', '/admin/login', { password: 'admin' });
  assert.equal(stale.status, 401);
  return cookieOf(changed.cookie);
}

async function adminSession(port) {
  const login = await json(port, 'POST', '/admin/login', { password: 'admin-secret-1' });
  assert.equal(login.status, 200);
  assert.equal(login.payload.data.mustChangePassword, false);
  return cookieOf(login.cookie);
}

describe('account memos and downloads', () => {
  it('keeps each account separate and restores memos after restart', async () => {
    const server = createApiServer(root, { dbPath });
    const port = await listen(server);
    try {
      const noHeader = await fetch(`http://127.0.0.1:${port}/admin/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey: '2026-11-12', time: '10:00' }),
      });
      assert.equal(noHeader.status, 403);

      const guestTree = await json(port, 'GET', '/tree');
      assert.equal(guestTree.status, 401);
      assert.equal(JSON.stringify(guestTree.payload).includes('drive.google'), false);

      const admin = await becomeAdmin(port);

      const officerBody = {
        officers: [
          { id: 'user_aaaa1111', position: '기획처장', name: '김민수', email: 'kim@yeonsung.ac.kr', employeeNo: '20240001' },
          { id: 'user_bbbb2222', position: '교무처장', name: '이서연', email: 'lee@yeonsung.ac.kr', employeeNo: '20240002' },
        ],
      };
      const saved = await json(port, 'PUT', '/admin/officers', officerBody, admin);
      assert.equal(saved.status, 200);
      assert.equal(saved.payload.data.officers.some((row) => row.employeeNo === '20240001'), true);

      const roster = await json(port, 'GET', '/roster');
      assert.equal(JSON.stringify(roster.payload).includes('20240001'), false);

      const userUpload = await json(port, 'POST', '/admin/meetings', { dateKey: '2026-11-12', time: '10:00' });
      assert.equal(userUpload.status, 401);

      const meeting = await json(port, 'POST', '/admin/meetings', { dateKey: '2026-11-12', time: '10:00', title: '확대간부회의' }, admin);
      assert.equal(meeting.status, 200);
      const meetingId = meeting.payload.data.folderId;

      const pdf = await PDFDocument.create();
      const page = pdf.addPage([400, 500]);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      page.drawText('agenda', { x: 48, y: 420, size: 18, font });
      pdf.addPage([400, 500]);
      const bytes = Buffer.from(await pdf.save());
      const uploaded = await fetch(`http://127.0.0.1:${port}/admin/meetings/${meetingId}/files`, {
        method: 'POST',
        headers: {
          'X-Depthm-Request': '1',
          Cookie: admin,
          'X-Category': encodeURIComponent('본문'),
          'X-File-Name': encodeURIComponent('1_예산안.pdf'),
          'Content-Type': 'application/pdf',
        },
        body: bytes,
      });
      const uploadedJson = await uploaded.json();
      assert.equal(uploaded.status, 200, JSON.stringify(uploadedJson));
      const fileId = uploadedJson.data.id;
      assert.equal(fs.existsSync(path.join(root, '26.11.12.', '본문', '1_예산안.pdf')), true);

      const asUser = await fetch(`http://127.0.0.1:${port}/admin/meetings/${meetingId}/files`, {
        method: 'POST',
        headers: { 'X-Depthm-Request': '1', 'Content-Type': 'application/pdf' },
        body: bytes,
      });
      assert.equal(asUser.status, 401);

      const loginA = await json(port, 'POST', '/login', { officerId: 'user_aaaa1111', password: '20240001' });
      assert.equal(loginA.status, 200);
      assert.equal(loginA.payload.data.mustChangePassword, true);
      assert.equal(loginA.payload.data.userId, 'user_aaaa1111');
      const cookieA = cookieOf(loginA.cookie);
      const blocked = await json(port, 'GET', '/tree', null, cookieA);
      assert.equal(blocked.status, 403);

      const changed = await json(port, 'POST', '/password', { newPassword: 'meeting-0812' }, cookieA);
      assert.equal(changed.status, 200);
      const cookieA2 = cookieOf(changed.cookie);
      const missingCurrent = await json(port, 'POST', '/password', { newPassword: 'meeting-9999' }, cookieA2);
      assert.equal(missingCurrent.status, 401);
      const tree = await json(port, 'GET', '/tree', null, cookieA2);
      assert.equal(tree.status, 200);
      assert.equal(tree.payload.data.folders[0].id, meetingId);

      const memo = {
        id: '11111111-1111-4111-8111-111111111111',
        driveFileId: fileId,
        page: 1,
        x: 0.2,
        y: 0.3,
        w: 0.02,
        h: 0.02,
        type: 'pin',
        content: '예산안 확인',
        color: '#2f6fed',
        status: 'active',
        version: 1,
        createdAt: '2026-11-12T01:00:00.000Z',
        updatedAt: '2026-11-12T01:00:00.000Z',
      };
      const put = await json(port, 'PUT', '/memos', { annotation: memo }, cookieA2);
      assert.equal(put.status, 200, JSON.stringify(put.payload));
      const clash = await json(port, 'PUT', '/memos', { annotation: { ...memo, content: '다른 내용', version: 1 } }, cookieA2);
      assert.equal(clash.status, 409);

      const loginB = await json(port, 'POST', '/login', { officerId: 'user_bbbb2222', password: '20240002' });
      const cookieB = cookieOf(loginB.cookie);
      await json(port, 'POST', '/password', { currentPassword: '20240002', newPassword: 'other-pass1' }, cookieB);
      const cookieB2 = cookieOf((await json(port, 'POST', '/login', { officerId: 'user_bbbb2222', password: 'other-pass1' })).cookie);
      const seenByB = await json(port, 'GET', `/memos?fileId=${fileId}`, null, cookieB2);
      assert.equal(seenByB.payload.data.annotations.length, 0);
      const deniedUpload = await fetch(`http://127.0.0.1:${port}/admin/files/${fileId}/delete`, {
        method: 'POST',
        headers: { 'X-Depthm-Request': '1', Cookie: cookieB2 },
      });
      assert.equal(deniedUpload.status, 403);

      const traversal = await json(port, 'GET', '/file?id=..%2F..%2Fpackage.json', null, cookieA2);
      assert.equal(traversal.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const again = createApiServer(root, { dbPath });
    const port2 = await listen(again);
    try {
      const loginA = await json(port2, 'POST', '/login', { officerId: 'user_aaaa1111', password: 'meeting-0812' });
      assert.equal(loginA.status, 200);
      assert.equal(loginA.payload.data.mustChangePassword, false);
      const cookieA = cookieOf(loginA.cookie);
      const tree = await json(port2, 'GET', '/tree', null, cookieA);
      const file = tree.payload.data.folders[0].children.find((child) => child.name === '본문').children[0];
      const memos = await json(port2, 'GET', `/memos?fileId=${file.id}`, null, cookieA);
      assert.equal(memos.payload.data.annotations[0].content, '예산안 확인');
      assert.equal(memos.payload.data.annotations[0].x, 0.2);

      const download = await fetch(`http://127.0.0.1:${port2}/download/file?id=${file.id}`, { headers: { Cookie: cookieA } });
      assert.equal(download.status, 200);
      const pdfBytes = new Uint8Array(await download.arrayBuffer());
      const disposition = download.headers.get('content-disposition') || '';
      assert.match(disposition, /1_%EB%B0%88%EC%82%B0%EC%95%88\.pdf|filename\*=UTF-8''/);
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ data: pdfBytes, isEvalSupported: false, useSystemFonts: false }).promise;
      const text = (await (await doc.getPage(1)).getTextContent()).items.map((item) => item.str).join('');
      assert.match(text, /예산안 확인/);
      const original = fs.readFileSync(path.join(root, '26.11.12.', '본문', '1_예산안.pdf'));
      assert.equal(original.subarray(0, 5).toString(), '%PDF-');
      assert.notEqual(Buffer.from(pdfBytes).equals(original), true);

      const zipRes = await fetch(`http://127.0.0.1:${port2}/download/meeting?id=${tree.payload.data.folders[0].id}`, { headers: { Cookie: cookieA } });
      assert.equal(zipRes.status, 200);
      assert.match(zipRes.headers.get('content-disposition') || '', /filename\*=UTF-8''2026\.11\.12%20%EB%B3%B4%EC%A7%81%ED%9A%8C%EC%9D%98%EC%9E%90%EB%A3%8C\.zip/);
      const zipBytes = Buffer.from(await zipRes.arrayBuffer());
      assert.equal(zipBytes.subarray(0, 2).toString(), 'PK');
      assert.equal(zipBytes.includes(Buffer.from('1_예산안.pdf')), true);

      const adminCookie = await adminSession(port2);
      const extra = await json(port2, 'POST', '/admin/meetings', { dateKey: '2026-12-03', time: '10:00', title: '보직회의', folderOnly: true }, adminCookie);
      assert.equal(extra.status, 200);
      const extraPdf = await PDFDocument.create();
      extraPdf.addPage([200, 200]);
      const extraUpload = await fetch(`http://127.0.0.1:${port2}/admin/meetings/${extra.payload.data.folderId}/files`, {
        method: 'POST',
        headers: {
          'X-Depthm-Request': '1',
          Cookie: adminCookie,
          'X-Category': encodeURIComponent('본문'),
          'X-File-Name': encodeURIComponent('잘못된자료.pdf'),
          'Content-Type': 'application/pdf',
        },
        body: Buffer.from(await extraPdf.save()),
      });
      const extraUploadJson = await extraUpload.json();
      assert.equal(extraUpload.status, 200, JSON.stringify(extraUploadJson));
      const scheduled = await json(port2, 'POST', '/admin/schedule', { meetingDate: '2026-12-03', meetingTime: '10:00' }, adminCookie);
      assert.equal(scheduled.payload.data.meetingDate, '2026-12-03');
      const deniedFolder = await json(port2, 'POST', '/admin/folders/delete', { dateKey: '2026-12-03' }, cookieA);
      assert.equal(deniedFolder.status, 403);
      const removed = await json(port2, 'POST', '/admin/folders/delete', { dateKey: '2026-12-03' }, adminCookie);
      assert.equal(removed.status, 200);
      assert.equal(removed.payload.data.folderDate, '26.12.03.');
      assert.equal(removed.payload.data.clearedSchedule, true);
      assert.equal(removed.payload.data.memosKept, true);
      assert.equal(fs.existsSync(path.join(root, '26.12.03.')), false);
      assert.equal(fs.existsSync(path.join(root, '.trash', `${extraUploadJson.data.id}.pdf`)), true);
      assert.equal(fs.existsSync(path.join(root, '26.11.12.', '본문', '1_예산안.pdf')), true);
      const afterTree = await json(port2, 'GET', '/tree', null, cookieA);
      assert.equal(afterTree.payload.data.folders.some((folder) => folder.id === extra.payload.data.folderId), false);
      const home = await json(port2, 'GET', '/admin/home', null, adminCookie);
      assert.equal(home.payload.data.settings.meetingDate, '');
      const keptMemo = await json(port2, 'GET', `/memos?fileId=${file.id}`, null, cookieA);
      assert.equal(keptMemo.payload.data.annotations[0].content, '예산안 확인');

      const reset = await json(port2, 'POST', '/admin/officers/user_aaaa1111/reset-password', {}, adminCookie);
      assert.equal(reset.status, 200);
      const oldPassword = await json(port2, 'POST', '/login', { officerId: 'user_aaaa1111', password: 'meeting-0812' });
      assert.equal(oldPassword.status, 401);
      const employeePassword = await json(port2, 'POST', '/login', { officerId: 'user_aaaa1111', password: '20240001' });
      assert.equal(employeePassword.status, 200);
      assert.equal(employeePassword.payload.data.mustChangePassword, true);
    } finally {
      await new Promise((resolve) => again.close(resolve));
    }
  });

  it('lets an admin see and clear a login lock', async () => {
    const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'depthm-lock-'));
    const server = createApiServer(lockRoot, { dbPath: path.join(lockRoot, '.depthm.sqlite') });
    const port = await listen(server);
    try {
      const admin = await becomeAdmin(port);
      const saved = await json(
        port,
        'PUT',
        '/admin/officers',
        {
          officers: [
            { id: 'user_lock3333', position: '기획처장', name: '김민수', email: 'lock@yeonsung.ac.kr', employeeNo: '20249999' },
          ],
        },
        admin,
      );
      assert.equal(saved.status, 200);
      assert.equal((await json(port, 'GET', '/admin/login-locks')).status, 401);
      const opened = await json(port, 'POST', '/login', { officerId: 'user_lock3333', password: '20249999' });
      assert.equal(opened.status, 200);

      for (let i = 0; i < 4; i += 1) {
        const wrong = await json(port, 'POST', '/login', { officerId: 'user_lock3333', password: 'wrong-pass' });
        assert.equal(wrong.status, 401);
      }
      const locked = await json(port, 'POST', '/login', { officerId: 'user_lock3333', password: 'wrong-pass' });
      assert.equal(locked.status, 429);
      const blocked = await json(port, 'POST', '/login', { officerId: 'user_lock3333', password: '20249999' });
      assert.equal(blocked.status, 429);

      const listed = await json(port, 'GET', '/admin/login-locks', null, admin);
      assert.equal(listed.status, 200);
      const account = listed.payload.data.locks.find((row) => row.key === 'user:user_lock3333');
      assert.equal(account.name, '김민수');
      assert.equal(account.position, '기획처장');
      assert.equal(account.kind, 'account');
      const cleared = await json(port, 'POST', '/admin/login-locks/clear', { key: 'user:user_lock3333' }, admin);
      assert.equal(cleared.status, 200);
      assert.equal(cleared.payload.data.locks.some((row) => row.key === 'user:user_lock3333'), false);
      const again = await json(port, 'POST', '/login', { officerId: 'user_lock3333', password: '20249999' });
      assert.equal(again.status, 200);

      for (let i = 0; i < 5; i += 1) {
        await json(port, 'POST', '/login', { officerId: `user_other${i}444`, password: 'wrong-pass' });
      }
      const addressBlocked = await json(port, 'POST', '/login', { officerId: 'user_lock3333', password: '20249999' });
      assert.equal(addressBlocked.status, 429);
      const addresses = await json(port, 'GET', '/admin/login-locks', null, admin);
      const address = addresses.payload.data.locks.find((row) => row.kind === 'address');
      assert.equal(address.kind, 'address');
      const addressCleared = await json(port, 'POST', '/admin/login-locks/clear', { key: address.key }, admin);
      assert.equal(addressCleared.status, 200);
      assert.equal(addressCleared.payload.data.locks.some((row) => row.kind === 'address'), false);
      const afterAddress = await json(port, 'POST', '/login', { officerId: 'user_lock3333', password: '20249999' });
      assert.equal(afterAddress.status, 200);
      const missing = await json(port, 'POST', '/admin/login-locks/clear', { key: address.key }, admin);
      assert.equal(missing.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('keeps the saved officer order on the login list', async () => {
    const orderRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'depthm-order-'));
    const server = createApiServer(orderRoot, { dbPath: path.join(orderRoot, '.depthm.sqlite') });
    const port = await listen(server);
    try {
      const admin = await becomeAdmin(port);
      const officers = [
        { id: 'user_order_kim', position: '기획처장', name: '김민수', email: 'kim.order@yeonsung.ac.kr', employeeNo: '20241111' },
        { id: 'user_order_lee', position: '교무처장', name: '이서연', email: 'lee.order@yeonsung.ac.kr', employeeNo: '20242222' },
      ];
      const saved = await json(port, 'PUT', '/admin/officers', { officers }, admin);
      assert.equal(saved.status, 200);
      const first = await json(port, 'GET', '/roster');
      assert.deepEqual(first.payload.data.officers.map((row) => row.id), ['user_order_kim', 'user_order_lee']);
      const reversed = await json(port, 'PUT', '/admin/officers', { officers: [officers[1], officers[0]] }, admin);
      assert.equal(reversed.status, 200);
      const second = await json(port, 'GET', '/roster');
      assert.deepEqual(second.payload.data.officers.map((row) => row.id), ['user_order_lee', 'user_order_kim']);
      const home = await json(port, 'GET', '/admin/home', null, admin);
      assert.deepEqual(home.payload.data.settings.officers.map((row) => row.id), ['user_order_lee', 'user_order_kim']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
