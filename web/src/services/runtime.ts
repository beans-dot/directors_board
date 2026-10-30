import { gasCall, GasError, NetworkError } from '../api/client';
import type { Annotation, DateFolder, DriveNode, LocalFile, Officer, Profile, PublicConfig } from '../api/types';
import { GAS_URL } from '../config';
import { writeAnnotation, listAnnotationsByFile, listAnnotationsByFolder, listAllAnnotations } from '../db/annotations';
import { blobKey, getFile, getPdfBlob, listFiles, pruneExpiredPdfs, putPdfBlob, upsertFile } from '../db/files';
import { kvGet, kvSet } from '../db/kv';
import { clearOutbox, enqueueOutbox, takeOutbox } from '../db/outbox';
import { clearProfile, createDeviceId, loadProfile, saveProfile } from '../db/profile';
import { loadTreeCache, saveTreeCache } from '../db/treeCache';
import { diffTrees, flattenFiles } from '../domain/treeDiff';
import { migrateAnnotations } from '../domain/migrate';
import { meetingPreloadSchedule, preloadStaggerMs } from '../domain/meetingRefresh';
import { pdfBytesCurrent } from '../domain/pdfVersion';
import { collectPdfs, topFolderOf } from '../domain/paths';
import { sortDriveTree } from '../domain/sort';
import { todayFolderDate } from '../domain/folderDate';
import { ADMIN_NAME, ADMIN_POSITION, asAdminAccount, isAdminAccount } from '../domain/account';
import { officerCanLogin } from '../domain/officers';
import { useApp } from '../state/app';
import { useMemoStore } from '../state/memo';
import { useTree } from '../state/tree';
import { useViewer } from '../state/viewer';
import { base64ToBytes } from './bytes';
import { createDownloadQueue } from './downloadQueue';
import { openPdfDocument } from './pdf';

let meetingRefreshTimer = 0;
let meetingPreloadSlot: number | null = null;
let meetingPreloadKey = '';
let meetingPreloadRunning = false;
let booted = false;
const pdfInflight = new Map<string, Promise<Uint8Array>>();
const pdfDownloadQueue = createDownloadQueue();

function ctx() {
  const profile = useApp.getState().profile;
  return { deviceId: profile?.deviceId || createDeviceId(), adminToken: profile?.adminToken };
}

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  window.addEventListener('online', () => {
    useApp.getState().patch({ online: true });
    void flushOutbox();
    void refreshTree('load');
  });
  window.addEventListener('offline', () => useApp.getState().patch({ online: false }));
  const persisted = await requestPersist();
  let profile = await loadProfile();
  if (profile?.role === 'admin' && !isAdminAccount(profile)) {
    profile = { ...asAdminAccount(profile), registeredAt: undefined };
    await saveProfile(profile);
  }
  const cache = await loadTreeCache();
  if (cache) {
    const folders = sortDriveTree(cache.root);
    useTree.getState().patch({
      folders,
      seenFolderIds: cache.seenFolderIds,
      seenFileIds: cache.seenFileIds,
      expanded: expandedForToday(folders),
    });
    useApp.getState().patch({ lastFetchedAt: cache.fetchedAt });
  }
  await pruneExpiredPdfs();
  useApp.getState().patch({
    profile,
    showOnboarding: !profile?.name,
    ready: true,
    online: navigator.onLine,
    statusText: navigator.onLine ? '' : offlineText(cache?.fetchedAt),
  });
  void persisted;
  if (profile?.name && !profile.registeredAt) await registerProfile(profile);
  await refreshTree('load');
  await flushOutbox();
}

async function requestPersist(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    await navigator.storage.persist();
    const ok = await navigator.storage.persisted();
    const shown = await kvGet<boolean>('persistWarned');
    if (!ok && !shown) {
      useApp.getState().toast('브라우저 데이터를 지우지 마세요');
      await kvSet('persistWarned', true);
    }
    await kvSet('persisted', ok);
    return ok;
  } catch {
    return null;
  }
}

export async function loadPublicConfig(): Promise<void> {
  if (!GAS_URL) {
    useApp.getState().patch({ statusText: 'VITE_GAS_URL이 설정되지 않았습니다.' });
    return;
  }
  if (!navigator.onLine) return;
  try {
    const config = await gasCall<PublicConfig>('config', {}, ctx());
    const profile = await syncStoredOfficer(useApp.getState().profile, config.officers || []);
    useApp.getState().patch({ config, profile: profile ?? useApp.getState().profile, statusText: '' });
    armMeetingRefresh();
  } catch (error) {
    useApp.getState().patch({ statusText: messageOf(error) });
  }
}

export async function syncStoredOfficer(profile: Profile | null, officers: Officer[]): Promise<Profile | null> {
  if (!profile?.officerId || profile.role === 'admin') return profile;
  const officer = officers.find((item) => item.id === profile.officerId);
  if (!officer || !officerCanLogin(officer)) return profile;
  const name = officer.name.trim();
  const position = officer.position.trim();
  const email = officer.email.trim();
  if (profile.name === name && profile.position === position && profile.savedEmail === email) return profile;
  const next = { ...profile, name, position, savedEmail: email };
  await saveProfile(next);
  return next;
}

export async function submitProfile(officer: Officer): Promise<void> {
  if (!officerCanLogin(officer)) return;
  const existing = useApp.getState().profile;
  const profile: Profile = {
    deviceId: existing?.deviceId || createDeviceId(),
    name: officer.name.trim(),
    position: officer.position.trim(),
    role: 'user',
    officerId: officer.id,
    savedEmail: officer.email.trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    registeredAt: existing?.registeredAt,
  };
  await saveProfile(profile);
  useApp.getState().patch({ profile, showOnboarding: false });
  await registerProfile(profile);
  await refreshTree('load');
}

async function registerProfile(profile: Profile): Promise<void> {
  if (!navigator.onLine || !GAS_URL) return;
  try {
    await gasCall('register', { name: profile.name, position: profile.position, userAgent: navigator.userAgent }, ctx());
    const next = { ...profile, registeredAt: new Date().toISOString() };
    await saveProfile(next);
    useApp.getState().patch({ profile: next });
  } catch {
    useApp.getState().toast('서버와 연결하지 못했습니다. 잠시 후 새로고침해 주세요.');
  }
}

export async function refreshTree(
  reason: 'load' | 'refresh' | 'preload',
  options?: { expandMeeting?: boolean; background?: boolean },
): Promise<void> {
  if (!GAS_URL) {
    useApp.getState().patch({ statusText: 'VITE_GAS_URL이 설정되지 않았습니다.' });
    return;
  }
  if (!navigator.onLine) {
    const cache = await loadTreeCache();
    useApp.getState().patch({ statusText: offlineText(cache?.fetchedAt), online: false });
    if (reason === 'preload') scheduleMeetingRetry();
    else armMeetingRefresh();
    return;
  }
  if (!options?.background) {
    useTree.getState().patch({ loading: true });
    useApp.getState().patch({ statusText: '자료 폴더를 확인하는 중…' });
  }
  meetingPreloadRunning = true;
  try {
    const [config, tree] = await Promise.all([
      gasCall<PublicConfig>('config', {}, ctx()),
      gasCall<{ fetchedAt: string; folders: DateFolder[] }>('tree', { reason }, ctx()),
    ]);
    const folders = sortDriveTree(tree.folders);
    const previous = await loadTreeCache();
    const diff = diffTrees(previous?.root ?? null, folders);
    await applyReplacements(previous?.root ?? [], folders, diff.replaced);
    const seenFolderIds = previous?.seenFolderIds ?? [];
    const seenFileIds = previous?.seenFileIds ?? [];
    const today = config.today || todayFolderDate();
    const expanded = reason === 'load' ? expandedForToday(folders, today) : { ...useTree.getState().expanded };
    if (options?.expandMeeting && config.meetingDate) {
      const meetingFolder = folders.find((folder) => folder.dateKey === config.meetingDate);
      if (meetingFolder) expanded[meetingFolder.id] = true;
    }
    await saveTreeCache({ fetchedAt: tree.fetchedAt, root: folders, seenFolderIds, seenFileIds });
    await kvSet('expanded', expanded);
    useTree.getState().patch({
      folders,
      loading: false,
      expanded,
      newFolderIds: diff.newFolderIds,
      newFileIds: diff.newFileIds,
      replacedIds: diff.replaced.map((item) => item.nextId),
      seenFolderIds,
      seenFileIds,
    });
    const synced = await syncStoredOfficer(useApp.getState().profile, config.officers || []);
    const meetingChanged = options?.expandMeeting && (diff.newFileIds.length > 0 || diff.newFolderIds.length > 0 || diff.replaced.length > 0);
    useApp.getState().patch({
      config,
      profile: synced ?? useApp.getState().profile,
      lastFetchedAt: tree.fetchedAt,
      statusText: '',
      online: true,
      drawerOpen: meetingChanged ? true : useApp.getState().drawerOpen,
    });
    if (diff.replaced.length) {
      const lines = diff.replaced.map((item) => item.path).join(', ');
      useApp.getState().patch({
        replaceNotice: `자료가 바뀌었음 — ${lines}. 기존 메모를 같은 위치로 옮겼습니다.`,
      });
    }
    await finishMeetingSchedule();
  } catch (error) {
    useTree.getState().patch({ loading: false });
    useApp.getState().patch({ statusText: messageOf(error) });
    if (error instanceof GasError && error.code !== 'BUSY') armMeetingRefresh();
    else scheduleMeetingRetry();
  } finally {
    meetingPreloadRunning = false;
  }
}

async function applyReplacements(
  previous: DateFolder[],
  next: DateFolder[],
  replaced: Array<{ path: string; previousId: string; nextId: string }>,
): Promise<void> {
  const prevFiles = new Map(flattenFiles(previous).map((file) => [file.id, file]));
  const nextFiles = new Map(flattenFiles(next).map((file) => [file.id, file]));
  for (const change of replaced) {
    const before = prevFiles.get(change.previousId);
    const after = nextFiles.get(change.nextId);
    if (!before || !after) continue;
    const local = await getFile(change.previousId);
    const anns = await listAnnotationsByFile(change.previousId);
    const moved = migrateAnnotations({
      annotations: anns,
      nextFileId: change.nextId,
      previous: { modifiedTime: before.modifiedTime || '', md5: before.md5Checksum, driveFileId: before.id },
      at: new Date().toISOString(),
    });
    for (const ann of moved.annotations) {
      if (ann.driveFileId === change.nextId) await writeAnnotation(ann, 'migrate');
    }
    if (local) {
      const record: LocalFile = {
        ...local,
        driveFileId: change.nextId,
        path: after.path,
        modifiedTime: after.modifiedTime || local.modifiedTime,
        md5: after.md5Checksum,
        versions: local.currentBlobKey
          ? [
              ...local.versions,
              {
                blobKey: local.currentBlobKey,
                modifiedTime: local.modifiedTime,
                md5: local.md5,
                replacedAt: new Date().toISOString(),
                driveFileId: change.previousId,
              },
            ]
          : local.versions,
        currentBlobKey: undefined,
      };
      await upsertFile(record);
    }
  }
}

function expandedForToday(folders: DateFolder[], today = todayFolderDate()): Record<string, boolean> {
  const todayFolder = folders.find((folder) => folder.folderDate === today);
  return todayFolder ? { [todayFolder.id]: true } : {};
}

function syncMeetingPreloadKey(): void {
  const config = useApp.getState().config;
  const key = `${config?.meetingDate ?? ''}|${config?.meetingTime ?? ''}`;
  if (key === meetingPreloadKey) return;
  meetingPreloadKey = key;
  meetingPreloadSlot = null;
}

function scheduleMeetingRetry(): void {
  if (meetingRefreshTimer) window.clearTimeout(meetingRefreshTimer);
  meetingRefreshTimer = window.setTimeout(() => {
    meetingRefreshTimer = 0;
    void refreshTree('preload', { expandMeeting: true, background: true });
  }, 15_000);
}

function meetingPlan() {
  syncMeetingPreloadKey();
  const config = useApp.getState().config;
  if (!config?.meetingDate || !config.meetingTime) return null;
  return meetingPreloadSchedule(new Date(), config.meetingDate, config.meetingTime, meetingPreloadSlot);
}

async function pdfIsCached(node: DriveNode): Promise<boolean> {
  const local = await getFile(node.id);
  if (!pdfBytesCurrent(node, local) || !local?.currentBlobKey) return false;
  return Boolean(await getPdfBlob(local.currentBlobKey));
}

async function warmMeetingPdfs(): Promise<void> {
  const meetingDate = useApp.getState().config?.meetingDate;
  if (!meetingDate) return;
  const folder = useTree.getState().folders.find((item) => item.dateKey === meetingDate);
  if (!folder) return;
  const pending: DriveNode[] = [];
  for (const node of collectPdfs(folder)) {
    if (!(await pdfIsCached(node))) pending.push(node);
  }
  if (!pending.length) return;
  let failed: unknown;
  for (let index = 0; index < pending.length; index += 1) {
    useApp.getState().patch({ statusText: `회의 자료를 받아 두는 중… ${index + 1}/${pending.length}` });
    try {
      await ensurePdf(pending[index]);
    } catch (error) {
      failed = error;
    }
  }
  if (useApp.getState().statusText.startsWith('회의 자료를 받아 두는 중…')) {
    useApp.getState().patch({ statusText: '' });
  }
  if (failed) throw failed;
}

async function finishMeetingSchedule(): Promise<void> {
  try {
    await warmMeetingPdfs();
  } catch (error) {
    useApp.getState().patch({ statusText: messageOf(error) });
    if (error instanceof GasError && error.code !== 'BUSY') armMeetingRefresh();
    else scheduleMeetingRetry();
    return;
  }
  const plan = meetingPlan();
  if (plan?.phase === 'run') meetingPreloadSlot = plan.slot;
  armMeetingRefresh();
}

function fireMeetingRefresh(): void {
  if (meetingPreloadRunning) return;
  meetingRefreshTimer = 0;
  const plan = meetingPlan();
  if (!plan || plan.phase === 'done') return;
  if (plan.phase === 'wait') {
    armMeetingRefresh();
    return;
  }
  const offset = deviceStaggerMs();
  const into = Date.now() - plan.slotStartMs;
  if (into < offset) {
    meetingRefreshTimer = window.setTimeout(fireMeetingRefresh, offset - into);
    return;
  }
  if (!navigator.onLine) {
    scheduleMeetingRetry();
    return;
  }
  void refreshTree('preload', { expandMeeting: true, background: true });
}

function deviceStaggerMs(): number {
  return preloadStaggerMs(useApp.getState().profile?.deviceId || createDeviceId());
}

/** One sync when the app opens. Repeated syncs run from 10 minutes before the meeting until 1 minute before. */
export function armMeetingRefresh(): void {
  if (meetingRefreshTimer) window.clearTimeout(meetingRefreshTimer);
  meetingRefreshTimer = 0;
  const plan = meetingPlan();
  if (!plan || plan.phase === 'done') return;
  if (plan.phase === 'wait') {
    meetingRefreshTimer = window.setTimeout(fireMeetingRefresh, Math.min(plan.delayMs, 60 * 60 * 1000));
    return;
  }
  const offset = deviceStaggerMs();
  const into = Date.now() - plan.slotStartMs;
  const wait = into < offset ? offset - into : 0;
  meetingRefreshTimer = window.setTimeout(fireMeetingRefresh, wait);
}

export async function openPdf(node: DriveNode, readOnly = false, page = 1): Promise<void> {
  if (!node.isPdf) return;
  useViewer.getState().patch({ loading: true, file: node, readOnly });
  useTree.getState().patch({ selectedId: node.id });
  useApp.getState().patch({ drawerOpen: false });
  try {
    const bytes = await ensurePdf(node);
    const doc = await openPdfDocument(bytes);
    const items = await memosInFolder(node.path.split('/')[0] || '', node.id);
    const local = await getFile(node.id);
    if (local) await upsertFile({ ...local, pageCount: doc.numPages, lastOpenedAt: new Date().toISOString() });
    useViewer.getState().patch({ doc, page, pageCount: doc.numPages, loading: false, local: local ?? null });
    useMemoStore.getState().patch({ items, editorId: null });
    const seen = new Set(useTree.getState().seenFileIds);
    seen.add(node.id);
    useTree.getState().patch({ seenFileIds: [...seen] });
    const cache = await loadTreeCache();
    if (cache) await saveTreeCache({ ...cache, seenFileIds: [...seen] });
    await track('열람', node.path.split('/')[0], node.path);
  } catch (error) {
    useViewer.getState().patch({ loading: false });
    useApp.getState().toast(messageOf(error));
  }
}

export function ensurePdf(node: DriveNode): Promise<Uint8Array> {
  const existing = pdfInflight.get(node.id);
  if (existing) return existing;
  const job = loadPdf(node);
  pdfInflight.set(node.id, job);
  void job.finally(() => {
    if (pdfInflight.get(node.id) === job) pdfInflight.delete(node.id);
  });
  return job;
}

async function loadPdf(node: DriveNode): Promise<Uint8Array> {
  const cached = await readCachedPdf(node);
  if (cached) return cached;
  return pdfDownloadQueue.run(() => downloadPdf(node));
}

async function readCachedPdf(node: DriveNode): Promise<Uint8Array | null> {
  const local = await getFile(node.id);
  if (!pdfBytesCurrent(node, local) || !local?.currentBlobKey) return null;
  const blob = await getPdfBlob(local.currentBlobKey);
  if (!blob) return null;
  return new Uint8Array(await blob.blob.arrayBuffer());
}

async function downloadPdf(node: DriveNode): Promise<Uint8Array> {
  const local = await getFile(node.id);
  if (pdfBytesCurrent(node, local) && local?.currentBlobKey) {
    const blob = await getPdfBlob(local.currentBlobKey);
    if (blob) return new Uint8Array(await blob.blob.arrayBuffer());
  }
  if (!navigator.onLine) throw new NetworkError('오프라인입니다. 받아둔 자료만 볼 수 있어요.');
  const data = await gasCall<{ base64: string; modifiedTime?: string; md5Checksum?: string; size?: number; name: string }>(
    'file',
    { fileId: node.id },
    ctx(),
  );
  const bytes = base64ToBytes(data.base64);
  const key = blobKey(node.id, data.md5Checksum, data.modifiedTime || node.modifiedTime || '');
  try {
    await putPdfBlob({ key, blob: new Blob([bytes], { type: 'application/pdf' }), savedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      useApp.getState().toast('저장 공간이 부족합니다. 메모 없는 예전 자료를 지워 주세요.');
      await dropOldBlobs();
    } else {
      throw error;
    }
  }
  const record: LocalFile = {
    driveFileId: node.id,
    path: node.path,
    folderDate: node.path.split('/')[0] || '',
    topFolder: topFolderOf(node.path),
    name: node.name,
    modifiedTime: data.modifiedTime || node.modifiedTime || '',
    md5: data.md5Checksum,
    size: data.size,
    currentBlobKey: key,
    versions: local?.versions ?? [],
    downloadedAt: new Date().toISOString(),
  };
  await upsertFile(record);
  useTree.getState().patch({ localVersion: useTree.getState().localVersion + 1 });
  return bytes;
}

async function dropOldBlobs(): Promise<void> {
  const files = await listFiles();
  const anns = await listAllAnnotations();
  const used = new Set(anns.filter((ann) => ann.status === 'active').map((ann) => ann.driveFileId));
  const victim = files.find((file) => !used.has(file.driveFileId) && file.currentBlobKey);
  if (!victim?.currentBlobKey) return;
  const db = await import('../db/schema').then((mod) => mod.getDB());
  await db.delete('pdfBlobs', victim.currentBlobKey);
  await upsertFile({ ...victim, currentBlobKey: undefined });
}

export async function saveMemo(ann: Annotation, action: 'create' | 'update' | 'delete' | 'restore'): Promise<void> {
  await writeAnnotation(ann, action);
  const items = await memosInFolder(ann.folderDate, ann.driveFileId);
  useMemoStore.getState().patch({ items });
  void scheduleBackup();
}

function memosInFolder(folderDate: string, driveFileId: string): Promise<Annotation[]> {
  if (folderDate) return listAnnotationsByFolder(folderDate);
  return listAnnotationsByFile(driveFileId);
}

export async function track(action: string, folderDate?: string, target?: string): Promise<void> {
  const event = { action, folderDate, target, at: new Date().toISOString() };
  if (!navigator.onLine || !GAS_URL) {
    await enqueueOutbox(event);
    return;
  }
  try {
    await gasCall('log', { events: [event] }, ctx());
  } catch {
    await enqueueOutbox(event);
  }
}

export async function flushOutbox(): Promise<void> {
  if (!navigator.onLine || !GAS_URL) return;
  const rows = await takeOutbox();
  if (!rows.length) return;
  try {
    await gasCall('log', { events: rows.map(({ id: _id, ...event }) => event) }, ctx());
    await clearOutbox(rows.map((row) => row.id));
  } catch {
    /* keep the outbox */
  }
}

export async function loginAdmin(password: string): Promise<void> {
  const previous = useApp.getState().profile;
  const enteredFromGate = !previous?.name;
  if (enteredFromGate) {
    const profile: Profile = {
      deviceId: previous?.deviceId || createDeviceId(),
      name: ADMIN_NAME,
      position: ADMIN_POSITION,
      role: 'user',
      createdAt: previous?.createdAt || new Date().toISOString(),
    };
    await saveProfile(profile);
    useApp.getState().patch({ profile });
    await registerProfile(profile);
  }
  try {
    const data = await gasCall<{ adminToken: string; exp: number }>('adminLogin', { password }, ctx());
    const current = useApp.getState().profile ?? previous;
    const next = asAdminAccount(
      {
        deviceId: current?.deviceId || createDeviceId(),
        name: ADMIN_NAME,
        position: ADMIN_POSITION,
        role: 'admin',
        createdAt: current?.createdAt || new Date().toISOString(),
        registeredAt: current?.registeredAt,
      },
      { adminToken: data.adminToken, adminTokenExp: data.exp },
    );
    await saveProfile(next);
    useApp.getState().patch({
      profile: next,
      showAdminConvert: false,
      showOnboarding: false,
      menuOpen: false,
      screen: enteredFromGate ? 'admin' : useApp.getState().screen,
    });
    if (!enteredFromGate) await registerProfile(next);
    useApp.getState().toast('관리자로 전환했습니다.');
  } catch (error) {
    if (enteredFromGate) {
      await clearProfile();
      useApp.getState().patch({ profile: null });
    }
    throw error;
  }
}

export async function logoutAdmin(): Promise<void> {
  const profile = useApp.getState().profile;
  if (!profile) return;
  await clearProfile();
  useApp.getState().patch({
    profile: null,
    screen: 'main',
    showOnboarding: true,
    showAdminConvert: false,
    menuOpen: false,
  });
}

let backupTimer = 0;
function scheduleBackup(): void {
  if (backupTimer) window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => {
    void import('./backupFlow').then((mod) => mod.autoBackup());
  }, 120_000);
}

function offlineText(fetchedAt?: string): string {
  const label = fetchedAt ? fetchedAt.slice(11, 16) : '';
  return label
    ? `오프라인입니다. 받아둔 자료만 볼 수 있어요. (마지막 확인 ${label})`
    : '오프라인입니다. 받아둔 자료만 볼 수 있어요.';
}

export function messageOf(error: unknown): string {
  if (error instanceof GasError || error instanceof NetworkError) return error.message;
  if (error instanceof Error) return error.message;
  return '서버와 연결하지 못했습니다. 잠시 후 새로고침해 주세요.';
}

export function findFolderOf(fileId: string): DateFolder | null {
  for (const folder of useTree.getState().folders) {
    if (contains(folder, fileId)) return folder;
  }
  return null;
}

function contains(node: DriveNode, id: string): boolean {
  if (node.id === id) return true;
  return !!node.children?.some((child) => contains(child, id));
}
