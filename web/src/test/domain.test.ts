// Vitest runs in Node, and this package does not ship Node typings.
// @ts-expect-error node:fs is provided by the test runtime
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GasError, NetworkError, gasCall, gasFile, parsePdfBody } from '../api/client';
import type { Annotation, DateFolder, DriveNode, MemoBackupPayload } from '../api/types';
import {
  contentHashSource,
  dropDeletedMemos,
  mergeAnnotations,
  selectBackupsToDelete,
  sha256Hex,
  verifyBackup,
  withChecksum,
} from '../domain/backup';
import { sendMode, sendQueueLabel } from '../domain/capacity';
import { finishSendAttempt, sendAttemptId } from '../domain/sendAttempt';
import { storedRatioToPdf, storedRectToPdf, visualRatioToStored } from '../domain/coords';
import { isAllowedRecipient } from '../domain/email';
import { moveOfficer, officerCanLogin, prepareOfficerList } from '../domain/officers';
import { monthGrid } from '../domain/calendar';
import {
  dateKeyToFolderDate,
  formatMeetingLabel,
  meetingZipName,
  parseDateInput,
  parseFolderDate,
  todayFolderDate,
} from '../domain/folderDate';
import {
  meetingPreloadSchedule,
  msUntilMeetingRefresh,
  msUntilPack,
  packIsDue,
  preloadStaggerMs,
} from '../domain/meetingRefresh';
import { remoteRefreshAction, remoteRefreshNotice } from '../domain/remoteRefresh';
import { pdfBytesCurrent } from '../domain/pdfVersion';
import { pdfRetentionPlan } from '../domain/pdfRetention';
import { createDownloadQueue } from '../services/downloadQueue';
import { unzipSync } from 'fflate';
import { buildSendArchive, materialFolderOf, sendArchivePath } from '../domain/archive';
import { estimatePatchedBytes, patchStoredZip, storedZip } from '../domain/zipStore';
import {
  collectPdfs,
  memoFileName,
  pickSendFolder,
  preloadPdfNodes,
  topFolderOf,
} from '../domain/paths';
import { placeUnderline } from '../domain/underline';
import { marksToClear } from '../domain/marks';
import { notePageVisibility, resetPageVisibility } from '../components/viewer/pageScroll';
import { migrateAnnotations } from '../domain/migrate';
import { MEMO_LANE_WIDTH, flattenPdf, memoLanePoint, placeMemoSlots } from '../domain/flatten';
import { pinNumberMap } from '../domain/pinNumbers';
import { naturalCompare, sortDriveTree } from '../domain/sort';
import { buildSummary, sourceFolderNote } from '../domain/summary';
import { diffTrees } from '../domain/treeDiff';
import {
  listAllAnnotations,
  listRevisions,
  purgeDeletedMemos,
  writeAnnotation,
} from '../db/annotations';
import { addMemoBackup, listMemoBackups, purgeDeletedMemosFromBackups } from '../db/memoBackups';

function ann(partial: Partial<Annotation> & Pick<Annotation, 'id'>): Annotation {
  return {
    driveFileId: 'file-1',
    path: '2026.10.30./본문/1.pdf',
    folderDate: '2026.10.30.',
    topFolder: '본문',
    page: 1,
    x: 0.1,
    y: 0.2,
    w: 0.05,
    h: 0.05,
    type: 'pin',
    content: '예산',
    status: 'active',
    version: 1,
    createdAt: '2026-10-30T01:00:00+09:00',
    updatedAt: '2026-10-30T01:00:00+09:00',
    ...partial,
  };
}

describe('folder dates', () => {
  it('parses and normalizes folder names', () => {
    expect(parseFolderDate('26.10.30.')).toEqual({
      folderDate: '26.10.30.',
      dateKey: '2026-10-30',
    });
    expect(parseFolderDate('26.10.30')).toEqual({ folderDate: '26.10.30.', dateKey: '2026-10-30' });
    expect(parseFolderDate(' 26.1.5. ')).toEqual({
      folderDate: '26.01.05.',
      dateKey: '2026-01-05',
    });
    expect(parseFolderDate('회의자료')).toBeNull();
    expect(parseFolderDate('2026.10.30.')).toBeNull();
    expect(parseFolderDate('26.13.01.')).toBeNull();
    expect(meetingZipName('2026-11-12', '26.11.12.')).toBe('2026.11.12 보직회의자료.zip');
    expect(meetingZipName('', '26.1.5.')).toBe('2026.01.05 보직회의자료.zip');
  });

  it('turns a calendar day into a folder name', () => {
    expect(parseDateInput('2026-11-12')).toBe('2026-11-12');
    expect(parseDateInput('2026.11.12.')).toBe('2026-11-12');
    expect(parseDateInput('26.11.12.')).toBe('2026-11-12');
    expect(parseDateInput('26/1/5')).toBe('2026-01-05');
    expect(parseDateInput('회의자료')).toBeNull();
    expect(parseDateInput('2026-02-31')).toBeNull();
    expect(dateKeyToFolderDate('2026-11-06')).toBe('26.11.06.');
    expect(dateKeyToFolderDate('2026-02-31')).toBeNull();
    expect(dateKeyToFolderDate('1999-01-01')).toBeNull();
    expect(formatMeetingLabel('2026-11-06', '14:00')).toBe('회의 2026.11.06.(금) 14:00');
  });

  it('lays a month out from Sunday through Saturday', () => {
    const weeks = monthGrid(2026, 10);
    expect(weeks[0].map((day) => day.day)).toEqual([27, 28, 29, 30, 1, 2, 3]);
    expect(weeks[0][4]).toMatchObject({ dateKey: '2026-10-01', inMonth: true });
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks.at(-1)?.at(-1)).toMatchObject({ dateKey: '2026-10-31', inMonth: true });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('uses Asia/Seoul around the UTC boundary', () => {
    expect(todayFolderDate(new Date('2026-10-29T14:59:59Z'))).toBe('26.10.29.');
    expect(todayFolderDate(new Date('2026-10-29T15:00:00Z'))).toBe('26.10.30.');
  });
});

describe('meeting refresh', () => {
  it('waits until one minute before the meeting', () => {
    const now = new Date('2026-10-30T08:00:00+09:00');
    expect(msUntilMeetingRefresh(now, '2026-10-30', '09:00')).toBe(59 * 60 * 1000);
  });

  it('is due at that minute', () => {
    expect(
      msUntilMeetingRefresh(new Date('2026-10-30T08:59:00+09:00'), '2026-10-30', '09:00'),
    ).toBe(0);
    expect(
      msUntilMeetingRefresh(new Date('2026-10-30T08:59:01+09:00'), '2026-10-30', '09:00'),
    ).toBe(-1000);
  });

  it('crosses midnight for a meeting at 00:00', () => {
    const now = new Date('2026-10-29T23:00:00+09:00');
    expect(msUntilMeetingRefresh(now, '2026-10-30', '00:00')).toBe(59 * 60 * 1000);
  });

  it('ignores an empty or invalid meeting', () => {
    const now = new Date('2026-10-30T08:00:00+09:00');
    expect(msUntilMeetingRefresh(now, '', '09:00')).toBeNull();
    expect(msUntilMeetingRefresh(now, '2026-10-30', '')).toBeNull();
    expect(msUntilMeetingRefresh(now, '2026-02-31', '09:00')).toBeNull();
    expect(msUntilMeetingRefresh(now, '2026-10-30', '9:00')).toBeNull();
    expect(meetingPreloadSchedule(now, '2026-10-30', '9:00', null)).toBeNull();
  });

  it('checks 10, 5, and 1 minutes before the meeting', () => {
    const at = (clock: string) => new Date(`2026-10-30T${clock}+09:00`);
    expect(meetingPreloadSchedule(at('08:40:00'), '2026-10-30', '09:00', null)).toEqual({
      phase: 'wait',
      delayMs: 10 * 60 * 1000,
    });
    expect(meetingPreloadSchedule(at('08:50:00'), '2026-10-30', '09:00', null)).toMatchObject({
      phase: 'run',
      slot: 0,
    });
    expect(meetingPreloadSchedule(at('08:50:30'), '2026-10-30', '09:00', 0)).toMatchObject({
      phase: 'wait',
      delayMs: 4 * 60 * 1000 + 30_000,
    });
    expect(meetingPreloadSchedule(at('08:55:00'), '2026-10-30', '09:00', 0)).toMatchObject({
      phase: 'run',
      slot: 1,
    });
    expect(meetingPreloadSchedule(at('08:59:00'), '2026-10-30', '09:00', 1)).toMatchObject({
      phase: 'run',
      slot: 2,
    });
    expect(meetingPreloadSchedule(at('08:59:20'), '2026-10-30', '09:00', 2)).toEqual({
      phase: 'done',
    });
    expect(meetingPreloadSchedule(at('09:00:00'), '2026-10-30', '09:00', null)).toEqual({
      phase: 'done',
    });
  });

  it('keeps the last check when the timer wakes late, until the meeting starts', () => {
    const now = new Date('2026-10-29T23:59:40+09:00');
    expect(meetingPreloadSchedule(now, '2026-10-30', '00:00', null)).toMatchObject({
      phase: 'run',
      slot: 2,
    });
    expect(
      meetingPreloadSchedule(new Date('2026-10-30T00:00:00+09:00'), '2026-10-30', '00:00', null),
    ).toEqual({
      phase: 'done',
    });
  });

  it('prepares the zip 10 minutes after the meeting starts', () => {
    const at = (clock: string) => new Date(`2026-10-30T${clock}+09:00`);
    expect(msUntilPack(at('08:50:00'), '2026-10-30', '09:00')).toBe(20 * 60 * 1000);
    expect(msUntilPack(at('09:09:00'), '2026-10-30', '09:00')).toBe(60 * 1000);
    expect(msUntilPack(at('09:10:00'), '2026-10-30', '09:00')).toBe(0);
    expect(packIsDue(at('09:09:59'), '2026-10-30', '09:00')).toBe(false);
    expect(packIsDue(at('09:10:00'), '2026-10-30', '09:00')).toBe(true);
    expect(packIsDue(at('09:40:00'), '2026-10-30', '09:00')).toBe(true);
    expect(msUntilPack(at('09:00:00'), '', '09:00')).toBeNull();
    expect(packIsDue(at('09:10:00'), '2026-10-30', '')).toBe(false);
  });

  it('staggers devices inside a twenty second window', () => {
    expect(preloadStaggerMs('')).toBe(0);
    expect(preloadStaggerMs('11111111-1111-4111-8111-111111111111')).toBeGreaterThanOrEqual(0);
    expect(preloadStaggerMs('11111111-1111-4111-8111-111111111111')).toBeLessThan(20_000);
  });
});

describe('remote folder refresh', () => {
  const signal = '2026-11-02T09:04:00+09:00';

  it('waits until a tree response has recorded the current signal', () => {
    expect(remoteRefreshAction(null, signal, '')).toBe('wait');
  });

  it('runs when an admin signal is newer than the last tree response', () => {
    expect(remoteRefreshAction('2026-11-02T09:00:00+09:00', signal, '')).toBe('run');
    expect(remoteRefreshAction('', signal, '')).toBe('run');
  });

  it('ignores the signal a tree response already included, and one already scheduled', () => {
    expect(remoteRefreshAction(signal, signal, '')).toBe('ignore');
    expect(remoteRefreshAction('2026-11-02T09:05:00+09:00', signal, '')).toBe('ignore');
    expect(remoteRefreshAction('', '', '')).toBe('ignore');
    expect(remoteRefreshAction('2026-11-02T09:00:00+09:00', signal, signal)).toBe('ignore');
  });

  it('says when missing files were saved or still need another try', () => {
    expect(remoteRefreshNotice(0, 0)).toBe('자료 폴더를 다시 확인했습니다.');
    expect(remoteRefreshNotice(2, 0)).toBe('자료 폴더를 확인하고 2개 파일을 받아 두었습니다.');
    expect(remoteRefreshNotice(1, 1)).toBe(
      '자료 폴더를 확인했습니다. 받지 못한 파일이 있어 다시 받습니다.',
    );
  });
});

describe('pdf version', () => {
  const stored = { currentBlobKey: 'k', md5: 'aaa', modifiedTime: 't1' };

  it('skips a download when the checksum matches', () => {
    expect(pdfBytesCurrent({ md5Checksum: 'aaa', modifiedTime: 't2' }, stored)).toBe(true);
  });

  it('downloads again when the checksum changes', () => {
    expect(pdfBytesCurrent({ md5Checksum: 'bbb', modifiedTime: 't1' }, stored)).toBe(false);
    expect(pdfBytesCurrent({ md5Checksum: 'aaa' }, { currentBlobKey: undefined, md5: 'aaa' })).toBe(
      false,
    );
  });

  it('uses modified time when there is no checksum', () => {
    expect(
      pdfBytesCurrent({ modifiedTime: 't1' }, { currentBlobKey: 'k', modifiedTime: 't1' }),
    ).toBe(true);
    expect(
      pdfBytesCurrent({ modifiedTime: 't2' }, { currentBlobKey: 'k', modifiedTime: 't1' }),
    ).toBe(false);
  });
});

describe('stored pdf retention', () => {
  const now = Date.parse('2026-10-30T12:00:00+09:00');
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  it('keeps a PDF stored for fewer than 90 days', () => {
    expect(
      pdfRetentionPlan({ downloadedAt: daysAgo(89), currentBlobKey: 'current', versions: [] }, now),
    ).toEqual({ dropBlobKeys: [], clearCurrent: false });
  });

  it('drops a PDF stored for 90 days and old replaced copies', () => {
    expect(
      pdfRetentionPlan(
        {
          downloadedAt: daysAgo(90),
          currentBlobKey: 'current',
          versions: [
            { blobKey: 'old', replacedAt: daysAgo(100) },
            { blobKey: 'recent', replacedAt: daysAgo(10) },
          ],
        },
        now,
      ),
    ).toEqual({ dropBlobKeys: ['current', 'old'], clearCurrent: true });
  });

  it('uses the meeting folder date when the download time is missing', () => {
    expect(
      pdfRetentionPlan({ folderDate: '26.07.01.', currentBlobKey: 'current', versions: [] }, now)
        .clearCurrent,
    ).toBe(true);
    expect(
      pdfRetentionPlan({ folderDate: '26.10.01.', currentBlobKey: 'current', versions: [] }, now)
        .clearCurrent,
    ).toBe(false);
  });
});

describe('pdf download queue', () => {
  it('downloads one file at a time and still runs the files behind a failure', async () => {
    const queue = createDownloadQueue();
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const task =
      (label: string, fail = false) =>
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (fail) throw new Error(label);
        order.push(label);
      };
    const jobs = [queue.run(task('a')), queue.run(task('b', true)), queue.run(task('c'))];
    const results = await Promise.allSettled(jobs);
    expect(order).toEqual(['a', 'c']);
    expect(peak).toBe(1);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});

describe('send folder', () => {
  const folder = (id: string, folderDate: string, pdf: boolean) => ({
    id,
    name: folderDate,
    kind: 'folder' as const,
    mimeType: 'application/vnd.google-apps.folder',
    isPdf: false,
    path: folderDate,
    folderDate,
    children: pdf
      ? [
          {
            id: `${id}-pdf`,
            name: 'a.pdf',
            kind: 'file' as const,
            mimeType: 'application/pdf',
            isPdf: true,
            path: `${folderDate}/a.pdf`,
          },
        ]
      : [],
  });

  it('uses the open file folder, then a folder that actually has a PDF', () => {
    const empty = folder('empty', '26.11.02.', false);
    const filled = folder('filled', '26.10.26.', true);
    expect(pickSendFolder([empty, filled], '26.10.26./a.pdf', '26.10.30.')?.id).toBe('filled');
    expect(pickSendFolder([empty, filled], '', '26.10.30.')?.id).toBe('filled');
  });
});

describe('nested meeting folders', () => {
  it('keeps memos and send files for PDFs under 별첨 and 규정', () => {
    const pdf = (id: string, path: string) => ({
      id,
      name: path.split('/').pop() || path,
      kind: 'file' as const,
      mimeType: 'application/pdf',
      isPdf: true,
      path,
    });
    const sub = (id: string, name: string, file: ReturnType<typeof pdf>) => ({
      id,
      name,
      kind: 'folder' as const,
      mimeType: 'application/vnd.google-apps.folder',
      isPdf: false,
      path: `26.10.26./${name}`,
      children: [file],
    });
    const date = {
      id: 'date',
      name: '26.10.26.',
      kind: 'folder' as const,
      mimeType: 'application/vnd.google-apps.folder',
      isPdf: false,
      path: '26.10.26.',
      children: [
        pdf('main', '26.10.26./본문.pdf'),
        sub('att', '별첨', pdf('budget', '26.10.26./별첨/예산.pdf')),
        sub('rule', '규정', pdf('rule-file', '26.10.26./규정/학칙.pdf')),
      ],
    };
    expect(collectPdfs(date).map((file) => file.id)).toEqual(['main', 'budget', 'rule-file']);
    const older = { ...date, id: 'older', dateKey: '2026-10-26', folderDate: '26.10.26.' };
    const newer = {
      ...date,
      id: 'newer',
      dateKey: '2026-11-02',
      folderDate: '26.11.02.',
      children: [pdf('today', '26.11.02./본문.pdf')],
    };
    expect(preloadPdfNodes([older, newer], 'all').map((file) => file.id)).toEqual([
      'main',
      'budget',
      'rule-file',
      'today',
    ]);
    expect(preloadPdfNodes([newer, older], 'all', '2026-10-26').map((file) => file.id)).toEqual([
      'main',
      'budget',
      'rule-file',
      'today',
    ]);
    expect(preloadPdfNodes([older, newer], 'meeting', '2026-11-02').map((file) => file.id)).toEqual(
      ['today'],
    );
    expect(preloadPdfNodes([older, newer], 'meeting')).toEqual([]);
    expect(memoFileName(topFolderOf('26.10.26./본문.pdf'), '본문.pdf')).toBe('자료_본문_메모.pdf');
    expect(memoFileName(topFolderOf('26.10.26./별첨/예산.pdf'), '예산.pdf')).toBe(
      '별첨_예산_메모.pdf',
    );
    expect(memoFileName(topFolderOf('26.10.26./규정/학칙.pdf'), '학칙.pdf')).toBe(
      '규정_학칙_메모.pdf',
    );
  });
});

describe('send archive', () => {
  it('puts 본문 at the zip root and keeps 별첨 and 규정 as folders', () => {
    expect(sendArchivePath('26.10.30./본문/보직회의자료.pdf')).toBe('보직회의자료.pdf');
    expect(sendArchivePath('26.10.30./본문/2_기타.pdf')).toBe('2_기타.pdf');
    expect(sendArchivePath('26.10.26./본문.pdf')).toBe('본문.pdf');
    expect(sendArchivePath('26.10.30./별첨/가.pdf')).toBe('별첨/가.pdf');
    expect(sendArchivePath('26.10.30./별첨/팀/나.pdf')).toBe('별첨/팀/나.pdf');
    expect(sendArchivePath('26.10.30./규정/학칙.pdf')).toBe('규정/학칙.pdf');
    expect(materialFolderOf('26.10.26./본문.pdf')).toBe('본문');
    expect(materialFolderOf('26.10.30./별첨/가.pdf')).toBe('별첨');
  });

  it('leaves out 별첨 and 규정 when those folders have no PDF', () => {
    const body = new Uint8Array([1, 2, 3]);
    const archive = buildSendArchive(
      [
        { path: '26.10.30./본문/보직회의자료.pdf', bytes: body },
        { path: '26.10.30./본문/2_기타.pdf', bytes: new Uint8Array([4]) },
      ],
      '26.10.30.',
    );
    const unzipped = unzipSync(archive.bytes);
    expect(archive.name).toBe('보직회의_26.10.30.zip');
    expect(Object.keys(unzipped).sort()).toEqual(['2_기타.pdf', '보직회의자료.pdf']);
    expect(unzipped['보직회의자료.pdf']).toEqual(body);
    expect(
      Object.keys(unzipped).some((name) => name.startsWith('별첨/') || name.startsWith('규정/')),
    ).toBe(false);
  });

  it('packs every PDF, including ones outside 본문, without merging them', () => {
    const archive = buildSendArchive(
      [
        { path: '26.10.30./본문/보직회의자료.pdf', bytes: new Uint8Array([1]) },
        { path: '26.10.30./별첨/가.pdf', bytes: new Uint8Array([2]) },
        { path: '26.10.30./규정/학칙.pdf', bytes: new Uint8Array([3]) },
        { path: '26.10.30./10_메모.pdf', bytes: new Uint8Array([4]) },
      ],
      '26.10.30.',
    );
    expect(Object.keys(unzipSync(archive.bytes)).sort()).toEqual([
      '10_메모.pdf',
      '규정/학칙.pdf',
      '별첨/가.pdf',
      '보직회의자료.pdf',
    ]);
  });

  it('keeps Korean names in a stored zip and replaces only the memo file', () => {
    const body = new Uint8Array([1, 2, 3]);
    const extra = new Uint8Array([4, 5]);
    const memo = new Uint8Array([9, 9, 9, 9]);
    const archive = storedZip([
      { name: '보직회의자료.pdf', bytes: body },
      { name: '별첨/가.pdf', bytes: extra },
    ]);
    const patched = patchStoredZip(archive, [{ name: '별첨/가.pdf', bytes: memo }]);
    const unzipped = unzipSync(patched);
    expect(Object.keys(unzipped).sort()).toEqual(['별첨/가.pdf', '보직회의자료.pdf']);
    expect(unzipped['보직회의자료.pdf']).toEqual(body);
    expect(unzipped['별첨/가.pdf']).toEqual(memo);
    expect(
      estimatePatchedBytes(archive.byteLength, [
        { before: extra.byteLength, after: memo.byteLength },
      ]),
    ).toBe(archive.byteLength + 2);
  });

  it('refuses to patch a file that is not in the zip', () => {
    const archive = storedZip([{ name: '보직회의자료.pdf', bytes: new Uint8Array([1]) }]);
    expect(() =>
      patchStoredZip(archive, [{ name: '없는.pdf', bytes: new Uint8Array([2]) }]),
    ).toThrow(/찾지 못했/);
  });
});

describe('clear marks', () => {
  it('keeps memos and drops the other marks on this file', () => {
    const items = [
      ann({ id: 'memo', type: 'pin' }),
      ann({ id: 'pen', type: 'ink', content: '' }),
      ann({ id: 'line', type: 'underline', content: '' }),
      ann({ id: 'old', type: 'highlight', content: '', status: 'deleted' }),
      ann({ id: 'other', type: 'ink', content: '', driveFileId: 'file-2' }),
    ];
    expect(marksToClear(items, 'file-1').map((item) => item.id)).toEqual(['pen', 'line']);
  });
});

describe('underline placement', () => {
  it('keeps the line on the stroke that was drawn', () => {
    const line = placeUnderline({ x: 0.12, y: 0.21 }, { x: 0.32, y: 0.218 });
    expect(line.x).toBeCloseTo(0.12);
    expect(line.y).toBeCloseTo(0.21);
    expect(line.w).toBeCloseTo(0.2);
    expect(line.h).toBeCloseTo(0.008);
  });

  it('stays one line when the stroke moves downward', () => {
    const line = placeUnderline({ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.55 });
    expect(line.x).toBeCloseTo(0.1);
    expect(line.y).toBeCloseTo(0.2);
    expect(line.w).toBeCloseTo(0.3);
    expect(line.h).toBeCloseTo(0.35);
  });
});

describe('page visibility', () => {
  it('keeps the page that occupies more of the screen', () => {
    resetPageVisibility();
    expect(notePageVisibility(1, 500)).toBe(1);
    expect(notePageVisibility(2, 120)).toBe(1);
    expect(notePageVisibility(2, 640)).toBe(2);
    resetPageVisibility();
  });
});

describe('pin numbers', () => {
  it('numbers each page by the time the memo was created', () => {
    const page = [
      ann({ id: 'later', content: '나중', createdAt: '2026-10-30T02:00:00.000Z' }),
      ann({ id: 'earlier', content: '먼저', createdAt: '2026-10-30T01:00:00.000Z' }),
      ann({
        id: 'mark',
        type: 'highlight',
        content: '형광',
        createdAt: '2026-10-30T00:00:00.000Z',
      }),
    ];
    const numbers = pinNumberMap(page);
    expect(numbers.get('earlier')).toBe(1);
    expect(numbers.get('later')).toBe(2);
    expect(numbers.has('mark')).toBe(false);
  });
});

describe('natural sort', () => {
  it('orders numbered names before hangul and compares numbers by value', () => {
    const names = ['나', '10_c', '가', '2_b', '1_a'];
    expect(names.sort(naturalCompare)).toEqual(['1_a', '2_b', '10_c', '가', '나']);
  });
});

describe('meeting tree order', () => {
  const file = (id: string, name: string, path: string): DriveNode => ({
    id,
    name,
    kind: 'file',
    mimeType: 'application/pdf',
    isPdf: true,
    path,
  });
  const folder = (id: string, name: string, children: DriveNode[]): DriveNode => ({
    id,
    name,
    kind: 'folder',
    mimeType: 'application/vnd.google-apps.folder',
    isPdf: false,
    path: `26.10.30./${name}`,
    children,
  });
  const date = (children: DriveNode[]): DateFolder => ({
    id: 'date',
    name: '26.10.30.',
    kind: 'folder',
    mimeType: 'application/vnd.google-apps.folder',
    isPdf: false,
    path: '26.10.30.',
    folderDate: '26.10.30.',
    dateKey: '2026-10-30',
    children,
  });

  it('shows 본문, 별첨, and 규정 folders in that order', () => {
    const [sorted] = sortDriveTree([
      date([
        folder('rule', '규정', [file('rule-file', '학칙.pdf', '26.10.30./규정/학칙.pdf')]),
        folder('att', '별첨', [
          file('budget', '나.pdf', '26.10.30./별첨/나.pdf'),
          file('plan', '가.pdf', '26.10.30./별첨/가.pdf'),
        ]),
        folder('body', '본문', [
          file('main', '보직회의자료.pdf', '26.10.30./본문/보직회의자료.pdf'),
          file('extra', '2_기타.pdf', '26.10.30./본문/2_기타.pdf'),
        ]),
        file('note', '10_메모.pdf', '26.10.30./10_메모.pdf'),
      ]),
    ]);
    expect(sorted.children?.map((child) => child.name)).toEqual([
      '본문',
      '별첨',
      '규정',
      '10_메모.pdf',
    ]);
    expect(sorted.children?.[0].children?.map((child) => child.name)).toEqual([
      '2_기타.pdf',
      '보직회의자료.pdf',
    ]);
    expect(sorted.children?.[1].children?.map((child) => child.name)).toEqual(['가.pdf', '나.pdf']);
  });

  it('lists 별첨 files by office, starting from the [부서명 prefix', () => {
    const names = [
      '[행정지원처] 총무.pdf',
      '[산학협력단]별첨자료.pdf',
      '[학생취업처 별첨2] 배치.pdf',
      '[학생취업처 별첨1] 현황.pdf',
      '[입학홍보처]참고.pdf',
      '[교무처 별첨2]_지침.pdf',
      '[교무처 별첨1]_대비표.pdf',
      '[기획처 별첨2] 보고.pdf',
      '[기획처 별첨1] 계획.pdf',
      '[기타] 참고.pdf',
      '가.pdf',
    ];
    const [sorted] = sortDriveTree([
      date([
        folder(
          'att',
          '별첨',
          names.map((name, index) => file(`f${index}`, name, `26.10.30./별첨/${name}`)),
        ),
      ]),
    ]);
    expect(sorted.children?.[0].children?.map((child) => child.name)).toEqual([
      '[기획처 별첨1] 계획.pdf',
      '[기획처 별첨2] 보고.pdf',
      '[교무처 별첨1]_대비표.pdf',
      '[교무처 별첨2]_지침.pdf',
      '[입학홍보처]참고.pdf',
      '[학생취업처 별첨1] 현황.pdf',
      '[학생취업처 별첨2] 배치.pdf',
      '[산학협력단]별첨자료.pdf',
      '[행정지원처] 총무.pdf',
      '[기타] 참고.pdf',
      '가.pdf',
    ]);
  });

  it('hides 별첨 and 규정 folders that contain no files', () => {
    const [sorted] = sortDriveTree([
      date([
        folder('rule', '규정', []),
        folder('att', '별첨', [folder('empty-sub', '빈폴더', [])]),
        file('main', '보직회의 자료.pdf', '26.10.30./보직회의 자료.pdf'),
      ]),
    ]);
    expect(sorted.children?.map((child) => child.name)).toEqual(['보직회의 자료.pdf']);
  });

  it('hides hwp and spreadsheets in 본문 and 별첨', () => {
    const other = (id: string, name: string, path: string): DriveNode => ({
      id,
      name,
      kind: 'file',
      mimeType: 'application/octet-stream',
      isPdf: false,
      path,
    });
    const [sorted] = sortDriveTree([
      date([
        folder('body', '본문', [
          file('main', '보직회의자료.pdf', '26.10.30./본문/보직회의자료.pdf'),
          other('hwp', '안건.hwp', '26.10.30./본문/안건.hwp'),
        ]),
        folder('att', '별첨', [
          other('sheet', '예산.xlsx', '26.10.30./별첨/예산.xlsx'),
          file('plan', '가.pdf', '26.10.30./별첨/가.pdf'),
        ]),
        folder('rule', '규정', [other('doc', '학칙.hwp', '26.10.30./규정/학칙.hwp')]),
        other('loose', '메모.xlsx', '26.10.30./메모.xlsx'),
      ]),
    ]);
    expect(sorted.children?.map((child) => child.name)).toEqual(['본문', '별첨']);
    expect(sorted.children?.[0].children?.map((child) => child.name)).toEqual(['보직회의자료.pdf']);
    expect(sorted.children?.[1].children?.map((child) => child.name)).toEqual(['가.pdf']);
  });
});

describe('treeDiff', () => {
  const folder = (id: string, files: DateFolder['children']): DateFolder => ({
    id,
    name: '2026.10.30.',
    kind: 'folder',
    mimeType: 'application/vnd.google-apps.folder',
    isPdf: false,
    path: '2026.10.30.',
    folderDate: '2026.10.30.',
    dateKey: '2026-10-30',
    children: files,
  });
  const file = (id: string, path: string, md5: string, modifiedTime = 't1') => ({
    id,
    name: path.split('/').pop() || path,
    kind: 'file' as const,
    mimeType: 'application/pdf',
    isPdf: true,
    path,
    md5Checksum: md5,
    modifiedTime,
  });

  it('detects new folders, new files, checksum changes, and same-path reuploads', () => {
    const prev = [folder('d1', [file('a', '2026.10.30./본문/1.pdf', 'm1')])];
    const next = [
      folder('d1', [
        file('a', '2026.10.30./본문/1.pdf', 'm2'),
        file('b', '2026.10.30./본문/2.pdf', 'm9'),
      ]),
      folder('d2', []),
    ];
    const diff = diffTrees(prev, next);
    expect(diff.newFolderIds).toEqual(['d2']);
    expect(diff.newFileIds).toEqual(['b']);
    expect(diff.replaced).toEqual([
      {
        path: '2026.10.30./본문/1.pdf',
        previousId: 'a',
        nextId: 'a',
        reason: 'checksum',
        sameName: true,
      },
    ]);

    const reupload = diffTrees(prev, [folder('d1', [file('c', '2026.10.30./본문/1.pdf', 'm3')])]);
    expect(reupload.replaced[0]).toMatchObject({
      previousId: 'a',
      nextId: 'c',
      reason: 'reupload',
      sameName: true,
    });
    expect(reupload.newFileIds).toEqual([]);

    const renamed = diffTrees(prev, [folder('d1', [file('a', '2026.10.30./본문/2.pdf', 'm2')])]);
    expect(renamed.replaced[0]).toMatchObject({ reason: 'checksum', sameName: false });
    expect(renamed.newFileIds).toEqual([]);
  });
});

describe('migrate', () => {
  it('keeps coordinates and clamps to the last page', () => {
    const source = ann({ id: '1', page: 8, x: 0.2, y: 0.3 });
    const result = migrateAnnotations({
      annotations: [source],
      nextFileId: 'file-2',
      nextPageCount: 3,
      previous: { modifiedTime: 't0', md5: 'old', driveFileId: 'file-1' },
      at: '2026-10-30T02:00:00+09:00',
    });
    expect(result.movedCount).toBe(1);
    expect(result.annotations[0]).toMatchObject({
      driveFileId: 'file-2',
      page: 3,
      x: 0.2,
      y: 0.3,
      version: 2,
    });
    expect(result.annotations[0].content.startsWith('원래 8쪽')).toBe(true);
    expect(result.annotations[0].movedFromVersion?.driveFileId).toBe('file-1');
  });
});

describe('coords', () => {
  const box = { x: 10, y: 20, width: 100, height: 200 };

  it('maps rotation-0 ratios onto the crop box', () => {
    expect(storedRatioToPdf(box, 0, 0)).toEqual({ x: 10, y: 220 });
    expect(storedRatioToPdf(box, 1, 1)).toEqual({ x: 110, y: 20 });
    expect(storedRectToPdf(box, 0.1, 0.2, 0.5, 0.25)).toEqual({
      x: 20,
      y: 130,
      width: 50,
      height: 50,
    });
  });

  it('converts visual ratios for 90, 180, and 270 degree pages', () => {
    expect(visualRatioToStored(0, 0.2, 0.4)).toEqual({ x: 0.2, y: 0.4 });
    expect(visualRatioToStored(90, 0.2, 0.4)).toEqual({ x: 0.4, y: 0.8 });
    expect(visualRatioToStored(180, 0.2, 0.4)).toEqual({ x: 0.8, y: 0.6 });
    expect(visualRatioToStored(270, 0.2, 0.4)).toEqual({ x: 0.6, y: 0.2 });
  });
});

describe('summary', () => {
  it('escapes html and groups by folder, file, and page', () => {
    const summary = buildSummary([
      {
        topFolder: '본문',
        name: '1_<예산>.pdf',
        annotations: [
          ann({ id: '1', content: '<script>', page: 2 }),
          ann({ id: '2', type: 'highlight', content: '', page: 2 }),
        ],
      },
      { topFolder: '별첨', name: '빈.pdf', annotations: [] },
    ]);
    expect(summary.html).toContain('&lt;script&gt;');
    expect(summary.html).not.toContain('<script>');
    expect(summary.text).toContain('[본문]');
    expect(summary.text).toContain('[형광펜] 2쪽');
    expect(summary.text).toContain('(메모 없음)');
  });

  it('includes the source Drive folder address', () => {
    const note = sourceFolderNote('folder abc');
    expect(note.text).toBe('원본 자료\nhttps://drive.google.com/drive/folders/folder%20abc');
    expect(note.html).toContain('href="https://drive.google.com/drive/folders/folder%20abc"');
  });
});

describe('send attempt', () => {
  it('reuses one id until the mail is confirmed', () => {
    finishSendAttempt();
    const first = sendAttemptId('folder', 'a@yeonsung.ac.kr');
    expect(sendAttemptId('folder', ' a@yeonsung.ac.kr ')).toBe(first);
    const other = sendAttemptId('folder', 'b@yeonsung.ac.kr');
    expect(other).not.toBe(first);
    finishSendAttempt();
    expect(sendAttemptId('folder', 'b@yeonsung.ac.kr')).not.toBe(other);
  });
});

describe('capacity and email', () => {
  it('switches to link above 25MB', () => {
    expect(sendMode(26_214_400)).toBe('attach');
    expect(sendMode(26_214_401)).toBe('link');
    expect(sendQueueLabel(0)).toBe('순서대로 보내는 중');
    expect(sendQueueLabel(3)).toBe('앞에 3통이 있어 기다리는 중');
  });

  it('allows only a single yeonsung address', () => {
    expect(isAllowedRecipient('a@yeonsung.ac.kr')).toBe(true);
    expect(isAllowedRecipient(' A@YEONSUNG.AC.KR ')).toBe(true);
    expect(isAllowedRecipient('a@gmail.com')).toBe(false);
    expect(isAllowedRecipient('a@sub.yeonsung.ac.kr')).toBe(false);
    expect(isAllowedRecipient('a@yeonsung.ac.kr.evil.com')).toBe(false);
    expect(isAllowedRecipient('a@yeonsung.ac.kr,b@gmail.com')).toBe(false);
  });
});

describe('gasCall', () => {
  const base = {
    url: 'https://example.test/exec',
    deviceId: '11111111-1111-4111-8111-111111111111',
    sleep: async () => undefined,
  };

  it('throws GasError when ok is false', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'EMAIL_NOT_ALLOWED', message: '불가' },
          serverTime: 't',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )) as typeof fetch;
    await expect(gasCall('send', {}, { ...base, fetchImpl })).rejects.toBeInstanceOf(GasError);
  });

  it('throws NetworkError on timeout', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    await expect(
      gasCall('config', {}, { ...base, fetchImpl, timeoutMs: 15 }),
    ).rejects.toMatchObject({
      name: 'NetworkError',
    });
  });

  it('throws NetworkError when fetch fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    await expect(gasCall('send', {}, { ...base, fetchImpl })).rejects.toBeInstanceOf(NetworkError);
  });

  it('retries a busy sync queue and then returns the file', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      const body =
        calls === 1
          ? { ok: false, error: { code: 'BUSY', message: '대기' }, serverTime: 't' }
          : { ok: true, data: { fileId: 'f' }, serverTime: 't' };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    await expect(gasCall('file', { fileId: 'f' }, { ...base, fetchImpl })).resolves.toEqual({
      fileId: 'f',
    });
    expect(calls).toBe(2);
  });

  it('reads a pdf body and retries when the file slot is busy', async () => {
    const meta = { fileId: 'f1', name: '자료.pdf', modifiedTime: 't', md5Checksum: 'abc', size: 3 };
    const body = `BOJIKPDF1\n${JSON.stringify(meta)}\nYQ==`;
    expect(parsePdfBody(body).base64).toBe('YQ==');
    expect(parsePdfBody(body).name).toBe('자료.pdf');
    expect(() =>
      parsePdfBody(
        JSON.stringify({
          ok: false,
          error: { code: 'NOT_FOUND', message: '없음' },
          serverTime: 't',
        }),
      ),
    ).toThrow(GasError);

    let calls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls += 1;
      const href = String(input);
      expect(href).toContain('action=file');
      expect(href).toContain('fileId=f1');
      const text =
        calls === 1
          ? JSON.stringify({ ok: false, error: { code: 'BUSY', message: '대기' }, serverTime: 't' })
          : body;
      return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }) as typeof fetch;
    await expect(gasFile('f1', { ...base, fetchImpl })).resolves.toMatchObject({
      fileId: 'f1',
      base64: 'YQ==',
    });
    expect(calls).toBe(2);
  });
});

describe('backup', () => {
  it('rejects a bad checksum and merges by updatedAt', async () => {
    const payload = await withChecksum({
      format: 'bojik-memo-backup',
      schemaVersion: 1,
      deviceId: 'd',
      profile: { name: '홍', position: '처장' },
      createdAt: '2026-10-30T00:00:00+09:00',
      scope: 'all',
      folders: [],
    });
    expect(await verifyBackup(payload)).toBe(true);
    const broken = { ...payload, checksum: '00' } as MemoBackupPayload;
    expect(await verifyBackup(broken)).toBe(false);

    const current = [ann({ id: '1', content: 'old', updatedAt: '2026-10-30T01:00:00+09:00' })];
    const incoming = [
      ann({ id: '1', content: 'new', updatedAt: '2026-10-30T03:00:00+09:00' }),
      ann({ id: '2', content: 'added' }),
    ];
    const merged = mergeAnnotations(current, incoming, '2026-10-30T04:00:00+09:00');
    expect(merged.counts).toEqual({ added: 1, updated: 1, same: 0 });
    expect(merged.annotations.find((item) => item.id === '1')?.content).toBe('new');
    expect(merged.revisions.some((rev) => rev.action === 'restore')).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('pdfBlobs');
  });

  it('removes deleted memos from a stored backup and keeps the checksum valid', async () => {
    const kept = ann({ id: 'keep' });
    const gone = ann({ id: 'gone', status: 'deleted' });
    const { id: _keptId, ...keptSnapshot } = kept;
    const { id: _goneId, ...goneSnapshot } = gone;
    const payload = await withChecksum({
      format: 'bojik-memo-backup',
      schemaVersion: 1,
      deviceId: 'd',
      profile: { name: '홍', position: '처장' },
      createdAt: '2026-10-30T00:00:00+09:00',
      scope: 'all',
      folders: [
        {
          folderDate: '2026.10.30.',
          files: [
            {
              driveFileId: 'file-1',
              path: '2026.10.30./본문/1.pdf',
              name: '1.pdf',
              modifiedTime: '2026-10-30T00:00:00+09:00',
              annotations: [kept, gone],
              revisions: [
                {
                  annotationId: 'keep',
                  version: 1,
                  action: 'create',
                  snapshot: keptSnapshot,
                  at: kept.updatedAt,
                },
                {
                  annotationId: 'gone',
                  version: 2,
                  action: 'delete',
                  snapshot: goneSnapshot,
                  at: gone.updatedAt,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(dropDeletedMemos(payload).removed).toBe(1);
    await addMemoBackup({
      id: 'b1',
      createdAt: payload.createdAt,
      reason: 'auto',
      sizeBytes: 10,
      annotationCount: 2,
      data: payload,
    });
    expect(await purgeDeletedMemosFromBackups()).toBe(1);
    const [row] = await listMemoBackups();
    const file = row.data.folders[0].files[0];
    expect(file.annotations.map((item) => item.id)).toEqual(['keep']);
    expect(file.revisions.map((rev) => rev.annotationId)).toEqual(['keep']);
    expect(await verifyBackup(row.data)).toBe(true);
  });

  it('skips an identical content hash', async () => {
    const a = contentHashSource([ann({ id: '1' })]);
    const b = contentHashSource([ann({ id: '1' })]);
    expect(a).toBe(b);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
  });

  it('prunes by age and size while keeping the newest backup', () => {
    const now = Date.parse('2026-10-30T00:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    const records = [
      { id: 'new', createdAt: new Date(now - day).toISOString(), sizeBytes: 40 },
      { id: 'old', createdAt: new Date(now - 91 * day).toISOString(), sizeBytes: 10 },
      { id: 'mid', createdAt: new Date(now - 10 * day).toISOString(), sizeBytes: 30 },
    ];
    expect(selectBackupsToDelete(records, { now, retentionDays: 90, maxTotalBytes: 100 })).toEqual([
      'old',
    ]);
    expect(selectBackupsToDelete(records, { now, retentionDays: 90, maxTotalBytes: 50 })).toEqual([
      'old',
      'mid',
    ]);
    expect(
      selectBackupsToDelete(
        [{ id: 'only', createdAt: new Date(now - 200 * day).toISOString(), sizeBytes: 999 }],
        {
          now,
          retentionDays: 7,
          maxTotalBytes: 10,
        },
      ),
    ).toEqual([]);
  });
});

describe('officers', () => {
  const row = {
    id: 'a1000001-0000-4000-8000-000000000001',
    position: '총장',
    name: '김연성',
    email: 'kim@yeonsung.ac.kr',
    employeeNo: '20240001',
  };

  it('lets a person sign in only when position, name, and employee number are set', () => {
    expect(officerCanLogin(row)).toBe(true);
    expect(officerCanLogin({ ...row, name: ' ' })).toBe(false);
    expect(officerCanLogin({ ...row, employeeNo: '' })).toBe(false);
    expect(isAllowedRecipient(row.email)).toBe(true);
    expect(prepareOfficerList([{ ...row, email: 'kim@gmail.com' }])).toEqual({
      error: '연성대학교 메일(@yeonsung.ac.kr)만 등록할 수 있습니다.',
    });
  });

  it('keeps drafts without a mail and rejects a duplicate campus mail', () => {
    const prepared = prepareOfficerList([
      row,
      {
        id: 'a1000002-0000-4000-8000-000000000002',
        position: '기획처장',
        name: '',
        email: '',
        employeeNo: '',
      },
    ]);
    expect('officers' in prepared && prepared.officers[1]?.email).toBe('');
    const duplicate = prepareOfficerList([
      row,
      { ...row, id: 'a1000003-0000-4000-8000-000000000003', position: '교무처장' },
    ]);
    expect(duplicate).toEqual({ error: '같은 메일 주소가 두 번 있습니다.' });
  });

  it('moves an officer to the dropped position', () => {
    const rows = [
      { id: 'a', position: '총장' },
      { id: 'b', position: '기획처장' },
      { id: 'c', position: '교무처장' },
    ];
    expect(moveOfficer(rows, 'c', 'a').map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(moveOfficer(rows, 'a', 'a')).toBe(rows);
    expect(moveOfficer(rows, 'missing', 'a')).toBe(rows);
  });
});

describe('memo lane', () => {
  it('keeps a box near its pin and pushes the next one below it', () => {
    const laid = placeMemoSlots(
      [
        { key: 'low', visualY: 0.8, height: 30 },
        { key: 'high', visualY: 0.2, height: 40 },
        { key: 'beside', visualY: 0.22, height: 40 },
      ],
      300,
      8,
      22,
    );
    expect(laid.overflow).toEqual([]);
    expect(laid.placed.map((slot) => slot.key)).toEqual(['high', 'beside', 'low']);
    expect(laid.placed[1].top).toBeGreaterThanOrEqual(laid.placed[0].top + 40 + 8);
    expect(laid.placed[2].top).toBeGreaterThan(laid.placed[1].top);
  });

  it('sends a box to the summary when the lane is full', () => {
    const laid = placeMemoSlots(
      [
        { key: 'a', visualY: 0.1, height: 80 },
        { key: 'b', visualY: 0.2, height: 80 },
      ],
      120,
      8,
      22,
    );
    expect(laid.placed.map((slot) => slot.key)).toEqual(['a']);
    expect(laid.overflow).toEqual(['b']);
  });

  it('maps the lane so local x grows toward the side and local y grows downward', () => {
    const lane = { x: 400, y: 0, width: 216, height: 600 };
    expect(memoLanePoint(lane, 0, 10, 20)).toEqual({ x: 410, y: 580 });
    expect(memoLanePoint({ x: 0, y: 600, width: 400, height: 216 }, 90, 10, 20)).toEqual({
      x: 20,
      y: 610,
    });
  });

  it('widens only pages that have a pin and leaves marks on the original page', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]);
    pdf.addPage([400, 600]);
    const fontBytes = new Uint8Array(readFileSync('public/fonts/NanumGothic-Regular.ttf'));
    const result = await flattenPdf({
      bytes: await pdf.save(),
      fontBytes,
      annotations: [
        ann({ id: 'pin-1', page: 1, y: 0.25, content: '옆 칸에 둘 메모' }),
        ann({ id: 'mark-1', page: 2, type: 'highlight', content: '', w: 0.2, h: 0.02 }),
      ],
    });
    const out = await PDFDocument.load(result.bytes);
    expect(result.failed).toBe(false);
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getWidth()).toBeCloseTo(400 + MEMO_LANE_WIDTH);
    expect(out.getPage(0).getHeight()).toBeCloseTo(600);
    expect(out.getPage(0).getCropBox().width).toBeCloseTo(400 + MEMO_LANE_WIDTH);
    expect(out.getPage(1).getWidth()).toBeCloseTo(400);
    const shown = await getDocument({
      data: result.bytes,
      disableWorker: true,
      isEvalSupported: false,
    } as Parameters<typeof getDocument>[0]).promise;
    const text = await (await shown.getPage(1)).getTextContent();
    const memo = text.items.find((item) => 'str' in item && item.str.includes('옆'));
    expect(memo && 'transform' in memo && memo.transform[4]).toBeGreaterThan(400);
  });

  it('grows the visual right side of a rotated page and adds a summary for a long memo', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 600]);
    page.setRotation(degrees(90));
    const fontBytes = new Uint8Array(readFileSync('public/fonts/NanumGothic-Regular.ttf'));
    const result = await flattenPdf({
      bytes: await pdf.save(),
      fontBytes,
      annotations: [ann({ id: 'pin-long', content: '가'.repeat(400) })],
    });
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPage(0).getWidth()).toBeCloseTo(400);
    expect(out.getPage(0).getHeight()).toBeCloseTo(600 + MEMO_LANE_WIDTH);
    expect(out.getPageCount()).toBe(2);
    const shown = await getDocument({
      data: result.bytes,
      disableWorker: true,
      isEvalSupported: false,
    } as Parameters<typeof getDocument>[0]).promise;
    const text = await (await shown.getPage(1)).getTextContent();
    const memo = text.items.find((item) => 'str' in item && item.str.includes('가'));
    expect(memo && 'transform' in memo && memo.transform[5]).toBeGreaterThan(600);
  });
});

describe('annotations', () => {
  it('writes one revision for create, update, and delete', async () => {
    const created = ann({ id: 'a1' });
    await writeAnnotation(created, 'create');
    const updated = {
      ...created,
      content: '수정',
      version: 2,
      updatedAt: '2026-10-30T05:00:00+09:00',
    };
    await writeAnnotation(updated, 'update');
    const deleted = {
      ...updated,
      status: 'deleted' as const,
      version: 3,
      updatedAt: '2026-10-30T06:00:00+09:00',
    };
    await writeAnnotation(deleted, 'delete');
    const revisions = await listRevisions('a1');
    expect(revisions.map((rev) => rev.action)).toEqual(['create', 'update', 'delete']);
    expect(deleted.status).toBe('deleted');
  });

  it('deletes stored deleted memos and their revisions', async () => {
    const kept = ann({ id: 'keep' });
    const gone = ann({ id: 'gone', status: 'deleted' });
    const ink = ann({ id: 'ink', type: 'ink', status: 'deleted', content: '' });
    await writeAnnotation(kept, 'create');
    await writeAnnotation(gone, 'delete');
    await writeAnnotation(ink, 'delete');
    expect(await purgeDeletedMemos()).toBe(1);
    expect((await listAllAnnotations()).map((item) => item.id).sort()).toEqual(['ink', 'keep']);
    expect(await listRevisions('gone')).toEqual([]);
    expect((await listRevisions('keep')).map((rev) => rev.action)).toEqual(['create']);
  });
});
