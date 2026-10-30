import { gasCall, GasError } from '../api/client';
import type { DateFolder } from '../api/types';
import { listAnnotationsByFile } from '../db/annotations';
import { addSendRecord } from '../db/sendHistory';
import { saveProfile } from '../db/profile';
import { buildSendArchive, materialFolderOf } from '../domain/archive';
import { sendMode, sendQueueLabel } from '../domain/capacity';
import { flattenPdf } from '../domain/flatten';
import { buildSummary, escapeHtml } from '../domain/summary';
import { useApp } from '../state/app';
import { bytesToBase64 } from './bytes';
import { glyphRunsByPage, loadKoreanFont } from './pdf';
import { ensurePdf, messageOf } from './runtime';
import { collectPdfs } from '../domain/paths';
import { autoBackup } from './backupFlow';

export interface PreparedFile {
  name: string;
  path: string;
  topFolder: string;
  zipPath: string;
  bytes: Uint8Array;
  memoCount: number;
  failed: boolean;
}

export interface PreparedPack {
  files: PreparedFile[];
  archiveName: string;
  archiveBytes: Uint8Array;
}

function deviceCtx() {
  const profile = useApp.getState().profile;
  return { deviceId: profile?.deviceId || '', adminToken: profile?.adminToken };
}

export async function prepareFolder(folder: DateFolder, onProgress: (text: string) => void): Promise<PreparedPack> {
  const pdfs = collectPdfs(folder);
  let font: Uint8Array | null = null;
  const prepared: PreparedFile[] = [];
  for (let index = 0; index < pdfs.length; index += 1) {
    const node = pdfs[index];
    const source = await ensurePdf(node);
    const annotations = await listAnnotationsByFile(node.id);
    const active = annotations.filter((ann) => ann.status === 'active');
    let bytes = source;
    let failed = false;
    if (active.length) {
      onProgress(`${index + 1}/${pdfs.length} PDF 만드는 중`);
      const needsFont = active.some((ann) => ann.content.trim() || ann.type === 'pin');
      if (needsFont && !font) {
        font = await loadKoreanFont().catch((error: unknown) => {
          throw new Error(messageOf(error));
        });
      }
      const runsByPage = active.some((ann) => ann.type === 'underline')
        ? await glyphRunsByPage(source).catch(() => [] as Awaited<ReturnType<typeof glyphRunsByPage>>)
        : [];
      try {
        const flat = await flattenPdf({ bytes: source, fontBytes: font, annotations: active, runsByPage });
        bytes = flat.bytes;
        failed = flat.failed;
      } catch (error) {
        if (error instanceof Error && error.message.includes('폰트')) throw error;
        failed = true;
      }
    } else {
      onProgress(`${index + 1}/${pdfs.length} 원본 넣는 중`);
    }
    prepared.push({
      name: node.name,
      path: node.path,
      topFolder: materialFolderOf(node.path),
      zipPath: '',
      bytes,
      memoCount: active.length,
      failed,
    });
  }
  onProgress('압축하는 중');
  const archive = buildSendArchive(
    prepared.map((file) => ({ path: file.path, bytes: file.bytes })),
    folder.folderDate,
  );
  prepared.forEach((file, index) => {
    file.zipPath = archive.entries[index];
    const slash = file.zipPath.lastIndexOf('/');
    file.name = slash >= 0 ? file.zipPath.slice(slash + 1) : file.zipPath;
  });
  return { files: prepared, archiveName: archive.name, archiveBytes: archive.bytes };
}

export function summaryOf(files: PreparedFile[]) {
  return buildSummary(
    files.map((file) => ({
      topFolder: file.topFolder,
      name: file.name,
      annotations: [],
    })),
  );
}

interface SendTicket {
  sent?: boolean;
  queued?: boolean;
  jobId?: string;
  ahead?: number;
  mode?: 'attach' | 'link';
  at?: string;
}

async function waitQueuedSend(jobId: string, onProgress?: (text: string) => void): Promise<SendTicket | null> {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const status = await gasCall<SendTicket>('sendStatus', { jobId }, { ...deviceCtx(), timeoutMs: 300_000 });
    if (status.sent) return status;
    onProgress?.(sendQueueLabel(status.ahead || 0));
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

const ARCHIVE_NOTE = '자료는 압축파일 하나입니다. 본문은 압축 맨 위에 있고, 파일이 있는 별첨·규정만 폴더로 들어 있습니다.';

export async function deliver(opts: {
  folder: DateFolder;
  to: string;
  subject: string;
  files: PreparedFile[];
  archiveName: string;
  archiveBytes: Uint8Array;
  annotationsForSummary: Parameters<typeof buildSummary>[0];
  force?: 'link';
  onProgress?: (text: string) => void;
}): Promise<void> {
  const profile = useApp.getState().profile;
  if (!profile) return;
  if (!navigator.onLine) throw new Error('인터넷 연결 후 다시 시도');
  const totalBytes = opts.archiveBytes.byteLength;
  const maxAttach = useApp.getState().config?.maxAttachBytes ?? 26_214_400;
  let mode = opts.force ?? sendMode(totalBytes, maxAttach);
  const summary = buildSummary(opts.annotationsForSummary);
  const sendId = crypto.randomUUID();
  let stagedFolderUrl = '';
  if (mode === 'link') {
    const staged = await gasCall<{ url: string }>(
      'stage',
      {
        folderDate: opts.folder.folderDate,
        sendId,
        to: opts.to,
        file: { name: opts.archiveName, base64: bytesToBase64(opts.archiveBytes) },
      },
      deviceCtx(),
    );
    stagedFolderUrl = staged.url;
  }
  const days = 7;
  const note = `<p>${escapeHtml(ARCHIVE_NOTE)}</p>`;
  const htmlBody =
    mode === 'link'
      ? `${summary.html}${note}<p>첨부 용량이 커서 Drive 링크로 보냅니다. ${days}일간 보관됩니다.<br><a href="${stagedFolderUrl}">${stagedFolderUrl}</a></p>`
      : `${summary.html}${note}`;
  let acceptedLate = false;
  try {
    const ticket = await gasCall<SendTicket>(
      'send',
      {
        sendId,
        folderDate: opts.folder.folderDate,
        to: opts.to,
        subject: opts.subject,
        htmlBody,
        textBody: `${summary.text}\n\n${ARCHIVE_NOTE}${mode === 'link' ? `\n${stagedFolderUrl}` : ''}`,
        mode,
        attachments: mode === 'attach' ? [{ name: opts.archiveName, base64: bytesToBase64(opts.archiveBytes) }] : [],
        stagedFolderUrl,
        fileCount: opts.files.length,
        totalBytes,
      },
      { ...deviceCtx(), timeoutMs: 360_000 },
    );
    if (ticket.queued && ticket.jobId) {
      opts.onProgress?.(sendQueueLabel(ticket.ahead || 0));
      const done = await waitQueuedSend(ticket.jobId, opts.onProgress);
      if (done?.mode) mode = done.mode;
      acceptedLate = !done?.sent;
    } else if (ticket.mode) {
      mode = ticket.mode;
    }
  } catch (error) {
    if (error instanceof GasError && error.code === 'TOO_LARGE' && mode === 'attach') {
      mode = 'link';
      await deliver({ ...opts, force: 'link' });
      return;
    }
    await addSendRecord({
      folderDate: opts.folder.folderDate,
      to: opts.to,
      subject: opts.subject,
      fileCount: opts.files.length,
      totalBytes,
      mode,
      ok: false,
      error: messageOf(error),
      at: new Date().toISOString(),
    });
    throw error;
  }
  const next = { ...profile, savedEmail: opts.to };
  await saveProfile(next);
  useApp.getState().patch({ profile: next });
  await addSendRecord({
    folderDate: opts.folder.folderDate,
    to: opts.to,
    subject: opts.subject,
    fileCount: opts.files.length,
    totalBytes,
    mode,
    ok: true,
    at: new Date().toISOString(),
  });
  await autoBackup('auto');
  useApp.getState().toast(
    acceptedLate
      ? '접수했습니다. 앞에서 보내는 메일이 끝나면 이어서 보내므로, 다시 누르지 않아도 됩니다.'
      : mode === 'link'
        ? `첨부 용량이 25MB를 넘어 Drive 링크로 보냈습니다(${days}일간 보관).`
        : `${opts.to}로 보냈습니다. 메일함을 확인하세요.`,
  );
}

export function downloadArchive(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes], { type: 'application/zip' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
