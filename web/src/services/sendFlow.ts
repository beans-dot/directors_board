import { gasCall, GasError, NetworkError } from '../api/client';
import type { Annotation, DateFolder, DriveNode } from '../api/types';
import { listAnnotationsByFile } from '../db/annotations';
import { addSendRecord } from '../db/sendHistory';
import { saveProfile } from '../db/profile';
import { archiveFileName, buildSendArchive, materialFolderOf } from '../domain/archive';
import { sendMode } from '../domain/capacity';
import { flattenPdf } from '../domain/flatten';
import { finishSendAttempt, sendAttemptId } from '../domain/sendAttempt';
import { buildSummary, escapeHtml, sourceFolderNote } from '../domain/summary';
import { estimatePatchedBytes } from '../domain/zipStore';
import { useApp } from '../state/app';
import { bytesToBase64Async } from './bytes';
import { loadKoreanFont } from './font';
import { ensurePdf, messageOf } from './runtime';
import { collectPdfs } from '../domain/paths';
import { autoBackup } from './backupFlow';

export interface PreparedFile {
  name: string;
  path: string;
  topFolder: string;
  zipPath: string;
  bytes: Uint8Array;
  size: number;
  memoCount: number;
  failed: boolean;
}

export interface PreparedPack {
  files: PreparedFile[];
  archiveName: string;
  archiveBytes: Uint8Array;
  packedBytes: number;
  usePack: boolean;
  packUrl: string;
  replacements: { zipPath: string; bytes: Uint8Array }[];
}

interface MaterialEntry {
  path: string;
  zipPath: string;
  name: string;
  size: number;
}

interface MaterialZip {
  ready?: boolean;
  building?: boolean;
  name?: string;
  size?: number;
  url?: string;
  entries?: MaterialEntry[];
}

function deviceCtx() {
  const profile = useApp.getState().profile;
  return { deviceId: profile?.deviceId || '', adminToken: profile?.adminToken };
}

async function memoTargets(pdfs: DriveNode[]): Promise<{ node: DriveNode; annotations: Annotation[] }[]> {
  const targets: { node: DriveNode; annotations: Annotation[] }[] = [];
  for (const node of pdfs) {
    const active = (await listAnnotationsByFile(node.id)).filter((ann) => ann.status === 'active');
    if (active.length) targets.push({ node, annotations: active });
  }
  return targets;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadMaterialZip(folderId: string, onProgress: (text: string) => void): Promise<MaterialZip | null> {
  const deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    try {
      const pack = await gasCall<MaterialZip>('materialZip', { folderId }, { ...deviceCtx(), timeoutMs: 360_000 });
      if (pack.ready && pack.entries?.length) return pack;
      if (!pack.building) return null;
    } catch (error) {
      if (error instanceof GasError && ['INVALID_ACTION', 'PACK_FAILED', 'NOT_FOUND', 'INVALID_INPUT'].includes(error.code)) return null;
      if (!(error instanceof GasError && error.code === 'BUSY') && !(error instanceof NetworkError)) throw error;
    }
    onProgress('압축을 준비하는 중');
    await sleep(3000);
  }
  return null;
}

function fileFromEntry(node: DriveNode, entry: MaterialEntry, memoCount: number, failed: boolean, bytes = new Uint8Array()): PreparedFile {
  return {
    name: entry.name,
    path: node.path,
    topFolder: materialFolderOf(node.path),
    zipPath: entry.zipPath,
    bytes,
    size: bytes.byteLength || entry.size,
    memoCount,
    failed,
  };
}

async function flattenTargets(
  targets: { node: DriveNode; annotations: Annotation[] }[],
  onProgress: (text: string) => void,
): Promise<Map<string, { bytes: Uint8Array; failed: boolean }>> {
  let font: Uint8Array | null = null;
  const done = new Map<string, { bytes: Uint8Array; failed: boolean }>();
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    onProgress(`메모 있는 PDF ${index + 1}/${targets.length} 만드는 중`);
    const source = await ensurePdf(target.node);
    const needsFont = target.annotations.some((ann) => ann.content.trim() || ann.type === 'pin');
    if (needsFont && !font) {
      font = await loadKoreanFont().catch((error: unknown) => {
        throw new Error(messageOf(error));
      });
    }
    try {
      const flat = await flattenPdf({ bytes: source, fontBytes: font, annotations: target.annotations });
      done.set(target.node.id, flat);
    } catch (error) {
      if (error instanceof Error && error.message.includes('폰트')) throw error;
      done.set(target.node.id, { bytes: source, failed: true });
    }
  }
  return done;
}

/** Downloads every PDF and zips on this device. Used for a local save, and when the prepared zip is not ready. */
export async function prepareFolderLocal(folder: DateFolder, onProgress: (text: string) => void): Promise<PreparedPack> {
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
      try {
        const flat = await flattenPdf({ bytes: source, fontBytes: font, annotations: active });
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
      size: bytes.byteLength,
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
  return {
    files: prepared,
    archiveName: archive.name,
    archiveBytes: archive.bytes,
    packedBytes: archive.bytes.byteLength,
    usePack: false,
    packUrl: '',
    replacements: [],
  };
}

export async function prepareFolder(folder: DateFolder, onProgress: (text: string) => void): Promise<PreparedPack> {
  const pdfs = collectPdfs(folder);
  const targets = await memoTargets(pdfs);
  onProgress(targets.length ? '압축 확인 중' : '준비된 압축 확인 중');
  const pack = await loadMaterialZip(folder.id, onProgress);
  const byPath = new Map((pack?.entries || []).map((entry) => [entry.path, entry]));
  const aligned = Boolean(pack?.ready && pack.entries && pdfs.length === pack.entries.length && pdfs.every((node) => byPath.has(node.path)));
  if (!aligned || !pack?.entries) return prepareFolderLocal(folder, onProgress);

  if (!targets.length) {
    return {
      files: pdfs.map((node) => fileFromEntry(node, byPath.get(node.path)!, 0, false)),
      archiveName: pack.name || archiveFileName(folder.folderDate),
      archiveBytes: new Uint8Array(),
      packedBytes: pack.size || 0,
      usePack: true,
      packUrl: pack.url || '',
      replacements: [],
    };
  }

  const flattened = await flattenTargets(targets, onProgress);
  const targetById = new Map(targets.map((target) => [target.node.id, target]));
  const swaps: { before: number; after: number }[] = [];
  const files = pdfs.map((node) => {
    const entry = byPath.get(node.path)!;
    const target = targetById.get(node.id);
    if (!target) return fileFromEntry(node, entry, 0, false);
    const flat = flattened.get(node.id);
    const failed = !flat || flat.failed;
    if (!flat || failed) return fileFromEntry(node, entry, target.annotations.length, true);
    swaps.push({ before: entry.size, after: flat.bytes.byteLength });
    const file = fileFromEntry(node, entry, target.annotations.length, false, flat.bytes);
    file.size = flat.bytes.byteLength;
    return file;
  });
  return {
    files,
    archiveName: pack.name || archiveFileName(folder.folderDate),
    archiveBytes: new Uint8Array(),
    packedBytes: estimatePatchedBytes(pack.size || 0, swaps),
    usePack: true,
    packUrl: '',
    replacements: files.filter((file) => file.memoCount > 0 && !file.failed).map((file) => ({ zipPath: file.zipPath, bytes: file.bytes })),
  };
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

const ARCHIVE_NOTE = '자료는 압축파일 하나입니다. 본문은 압축 맨 위에 있고, 파일이 있는 별첨·규정만 폴더로 들어 있습니다.';
const SEND_ACCEPTED = '서버에 요청하였습니다.';

export async function deliver(opts: {
  folder: DateFolder;
  to: string;
  subject: string;
  files: PreparedFile[];
  archiveName: string;
  archiveBytes: Uint8Array;
  packedBytes: number;
  usePack?: boolean;
  replacements?: { zipPath: string; bytes: Uint8Array }[];
  annotationsForSummary: Parameters<typeof buildSummary>[0];
  force?: 'link';
  sendId?: string;
  onProgress?: (text: string) => void;
}): Promise<void> {
  const profile = useApp.getState().profile;
  if (!profile) return;
  if (!navigator.onLine) throw new Error('인터넷 연결 후 다시 시도');
  const usePack = Boolean(opts.usePack);
  const replacements = opts.replacements || [];
  const totalBytes = opts.packedBytes;
  const maxAttach = useApp.getState().config?.maxAttachBytes ?? 26_214_400;
  let mode = opts.force ?? sendMode(totalBytes, maxAttach);
  const summary = buildSummary(opts.annotationsForSummary);
  const sendId = opts.sendId || sendAttemptId(opts.folder.id, opts.to);
  let stagedFolderUrl = '';
  if (!usePack && mode === 'link') {
    const staged = await gasCall<{ url: string }>(
      'stage',
      {
        folderDate: opts.folder.folderDate,
        sendId,
        to: opts.to,
        file: { name: opts.archiveName, base64: await bytesToBase64Async(opts.archiveBytes) },
      },
      deviceCtx(),
    );
    stagedFolderUrl = staged.url;
  }
  const days = 7;
  const source = sourceFolderNote(opts.folder.id);
  const note = `<p>${escapeHtml(ARCHIVE_NOTE)}</p>${source.html}`;
  const htmlBody =
    !usePack && mode === 'link'
      ? `${summary.html}${note}<p>첨부 용량이 커서 Drive 링크로 보냅니다. ${days}일간 보관됩니다.<br><a href="${stagedFolderUrl}">${stagedFolderUrl}</a></p>`
      : `${summary.html}${note}`;
  const textBody = `${summary.text}\n\n${ARCHIVE_NOTE}\n${source.text}${!usePack && mode === 'link' ? `\n${stagedFolderUrl}` : ''}`;
  try {
    await gasCall<SendTicket>(
      'send',
      {
        sendId,
        folderDate: opts.folder.folderDate,
        folderId: opts.folder.id,
        to: opts.to,
        subject: opts.subject,
        htmlBody,
        textBody,
        mode,
        usePack,
        replacements: usePack
          ? await Promise.all(replacements.map(async (item) => ({ zipPath: item.zipPath, base64: await bytesToBase64Async(item.bytes) })))
          : [],
        attachments: !usePack && mode === 'attach' ? [{ name: opts.archiveName, base64: await bytesToBase64Async(opts.archiveBytes) }] : [],
        stagedFolderUrl,
        fileCount: opts.files.length,
        totalBytes,
      },
      { ...deviceCtx(), timeoutMs: 120_000 },
    );
    opts.onProgress?.(SEND_ACCEPTED);
  } catch (error) {
    if (usePack && error instanceof GasError && error.code === 'PACK_FAILED') {
      opts.onProgress?.('이 기기에서 압축하는 중');
      const local = await prepareFolderLocal(opts.folder, opts.onProgress || (() => {}));
      await deliver({
        ...opts,
        files: local.files,
        archiveName: local.archiveName,
        archiveBytes: local.archiveBytes,
        packedBytes: local.packedBytes,
        usePack: false,
        replacements: [],
        sendId: crypto.randomUUID(),
      });
      return;
    }
    if (error instanceof GasError && error.code === 'TOO_LARGE' && mode === 'attach' && !usePack) {
      mode = 'link';
      await deliver({ ...opts, force: 'link', sendId });
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
  finishSendAttempt();
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
  void autoBackup('auto');
  await sleep(900);
  useApp.getState().toast(SEND_ACCEPTED);
}

export function downloadArchive(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes], { type: 'application/zip' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
