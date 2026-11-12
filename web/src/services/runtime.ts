import { GasError, NetworkError } from '../api/client';
import {
  MemoConflictError,
  bootFromServer,
  changePassword,
  fetchRoster,
  fetchSession,
  listServerMemos,
  loginAdminAccount,
  loginOfficer,
  logoutSession,
  logAccess,
  materialFile,
  materialMeta,
  pulseServer,
  putServerMemo,
  requestMaterialRefresh,
} from '../api/materials';
import type { Annotation, DateFolder, DriveNode, LocalFile, Officer, Profile, PublicConfig } from '../api/types';
import { marksToClear } from '../domain/marks';
import { writeAnnotation, deleteAnnotation, purgeDeletedMemos, listAnnotationsByFile, listAnnotationsByFolder, listAllAnnotations } from '../db/annotations';
import { purgeDeletedMemosFromBackups } from '../db/memoBackups';
import { blobKey, getFile, getPdfBlob, listFiles, pruneExpiredPdfs, putPdfBlob, upsertFile } from '../db/files';
import { kvGet, kvSet } from '../db/kv';
import { clearProfile, createDeviceId, loadProfile, saveProfile } from '../db/profile';
import { loadTreeCache, saveTreeCache } from '../db/treeCache';
import { diffTrees, flattenFiles } from '../domain/treeDiff';
import { migrateAnnotations } from '../domain/migrate';
import { preloadStaggerMs } from '../domain/meetingRefresh';
import { REMOTE_REFRESH_POLL_MS, remoteRefreshAction, remoteRefreshNotice } from '../domain/remoteRefresh';
import { normalizeChangeNotices, showFileChangeAlert } from '../domain/changeNotice';
import { pdfBytesCurrent } from '../domain/pdfVersion';
import { preloadPdfNodes, topFolderOf } from '../domain/paths';
import { sortDriveTree } from '../domain/sort';
import { dateKeyToFolderDate, todayFolderDate } from '../domain/folderDate';
import { asAdminAccount } from '../domain/account';
import { officerCanLogin } from '../domain/officers';
import { useApp } from '../state/app';
import { useMemoStore } from '../state/memo';
import { useTree } from '../state/tree';
import { useSplit } from '../state/splitView';
import { useViewer } from '../state/viewer';
import { base64ToBytes } from './bytes';
import { createDownloadQueue } from './downloadQueue';

let meetingPreloadRunning = false;
let booted = false;
let remoteWatchStarted = false;
let remotePollInflight = false;
let remoteRefreshDelayTimer = 0;
let pendingRemoteAt = '';
let appliedTreeRefreshAt: string | null = null;
let missingRetryLeft = 0;
let missingRetryTimer = 0;
let lastWarm: { saved: number; failed: number } = { saved: 0, failed: 0 };
let publishedWarm: { saved: number; failed: number } = { saved: 0, failed: 0 };
const pdfInflight = new Map<string, Promise<Uint8Array>>();
const pdfDownloadQueue = createDownloadQueue();

const memoTimers = new Map<string, number>();
let conflictLocal: Annotation | null = null;

function queueMemoSync(ann: Annotation): void {
  const prev = memoTimers.get(ann.id);
  if (prev) window.clearTimeout(prev);
  memoTimers.set(
    ann.id,
    window.setTimeout(() => {
      memoTimers.delete(ann.id);
      void pushMemo(ann.id);
    }, 400),
  );
}

async function rememberPending(ann: Annotation): Promise<void> {
  const pending = (await kvGet<Record<string, Annotation>>('pendingMemos')) || {};
  pending[ann.id] = ann;
  await kvSet('pendingMemos', pending);
}

async function forgetPending(id: string): Promise<void> {
  const pending = (await kvGet<Record<string, Annotation>>('pendingMemos')) || {};
  delete pending[id];
  await kvSet('pendingMemos', pending);
}

async function pushMemo(id: string): Promise<void> {
  const ann = (await listAllAnnotations()).find((item) => item.id === id);
  if (!ann) return;
  useApp.getState().patch({ memoSyncText: '메모를 저장하는 중' });
  try {
    const saved = await putServerMemo(ann);
    if (saved.version !== ann.version) await writeAnnotation(saved, 'update');
    await forgetPending(id);
    if (conflictLocal?.id === id) conflictLocal = null;
    useApp.getState().patch({ memoSyncText: '' });
  } catch (error) {
    if (error instanceof MemoConflictError) {
      conflictLocal = ann;
      useApp.getState().patch({ memoSyncText: '다른 화면의 메모와 겹쳐 저장하지 못했습니다. 이 기기의 내용은 남아 있습니다.' });
      return;
    }
    await rememberPending(ann);
    useApp.getState().patch({
      memoSyncText: error instanceof Error ? error.message : '메모가 서버에 저장되지 않았습니다. 이 기기에 남아 있습니다.',
    });
  }
}

export async function flushPendingMemos(): Promise<void> {
  const pending = (await kvGet<Record<string, Annotation>>('pendingMemos')) || {};
  for (const id of Object.keys(pending)) await pushMemo(id);
}

export async function overwriteConflictMemo(): Promise<void> {
  if (!conflictLocal) return;
  const saved = await putServerMemo(conflictLocal, true);
  await writeAnnotation(saved, 'update');
  conflictLocal = null;
  useApp.getState().patch({ memoSyncText: '' });
  useApp.getState().toast('이 기기의 메모를 서버에 저장했습니다.');
}

export async function reloadConflictMemo(): Promise<void> {
  if (!conflictLocal) return;
  const fileId = conflictLocal.driveFileId;
  const remote = await listServerMemos(fileId);
  for (const ann of remote) await writeAnnotation(ann, 'restore');
  conflictLocal = null;
  useApp.getState().patch({ memoSyncText: '' });
  useApp.getState().toast('서버에 저장된 메모를 불러왔습니다.');
}

async function annotationsForOpen(node: DriveNode): Promise<Annotation[]> {
  const folderDate = node.path.split('/')[0] || '';
  try {
    const remote = await listServerMemos(node.id);
    const remoteIds = new Set(remote.map((ann) => ann.id));
    for (const ann of remote) await writeAnnotation(ann, 'restore');
    for (const ann of await listAnnotationsByFile(node.id)) {
      if (!remoteIds.has(ann.id)) await deleteAnnotation(ann.id);
    }
    useApp.getState().patch({ memoSyncText: '' });
    return remote;
  } catch {
    useApp.getState().patch({ memoSyncText: '서버 메모를 불러오지 못했습니다. 화면에 있는 내용은 이 기기에만 있으며, 연결되면 다시 저장합니다.' });
    return memosInFolder(folderDate, node.id);
  }
}

function applyChangeNotices(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const next = normalizeChangeNotices(raw);
  const prev = useTree.getState().changeNotices;
  if (
    prev.length === next.length &&
    prev.every((item, index) => item.fileId === next[index].fileId && item.path === next[index].path)
  ) {
    return;
  }
  useTree.getState().patch({ changeNotices: next });
}

function profileFromSession(session: Awaited<ReturnType<typeof fetchSession>> & object, deviceId: string, createdAt: string): Profile {
  if (session.role === 'admin') {
    return asAdminAccount(
      {
        deviceId,
        name: session.name,
        position: session.position,
        role: 'admin',
        mustChangePassword: session.mustChangePassword,
        createdAt,
        registeredAt: new Date().toISOString(),
      },
      { adminToken: 'session' },
    );
  }
  return {
    deviceId,
    name: session.name,
    position: session.position,
    role: 'user',
    officerId: session.userId,
    mustChangePassword: session.mustChangePassword,
    createdAt,
    registeredAt: new Date().toISOString(),
  };
}

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  window.addEventListener('online', () => {
    useApp.getState().patch({ online: true, statusText: '' });
    void flushPendingMemos();
    void refreshTree('load');
  });
  window.addEventListener('offline', () => {
    useTree.getState().patch({ folders: [] });
    useApp.getState().patch({ online: false, statusText: '서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.' });
  });
  await requestPersist();
  await pruneExpiredPdfs();
  await purgeDeletedMemos();
  await purgeDeletedMemosFromBackups();
  const localFiles = await localFileMap();
  const deviceId = (await loadProfile())?.deviceId || createDeviceId();
  useTree.getState().patch({ folders: [], localFiles });
  try {
    const session = await fetchSession();
    if (!session) {
      await clearProfile();
      useApp.getState().patch({ profile: null, showOnboarding: true, ready: true, online: navigator.onLine, statusText: '' });
      await loadPublicConfig();
      return;
    }
    const profile = profileFromSession(session, deviceId, new Date().toISOString());
    await saveProfile(profile);
    useApp.getState().patch({
      profile,
      showOnboarding: false,
      showPassword: session.mustChangePassword,
      passwordRequired: session.mustChangePassword,
      ready: true,
      online: true,
      statusText: '',
      screen: session.role === 'admin' ? 'admin' : 'main',
    });
    if (session.mustChangePassword) return;
    startRemoteRefreshWatch();
    await refreshTree('load');
    await flushPendingMemos();
  } catch (error) {
    await clearProfile();
    useTree.getState().patch({ folders: [] });
    useApp.getState().patch({
      profile: null,
      showOnboarding: true,
      ready: true,
      statusText: messageOf(error),
    });
  }
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
  if (!navigator.onLine) {
    useApp.getState().patch({ statusText: '서버와 연결하지 못했습니다. 보직 목록을 표시하지 않습니다.' });
    return;
  }
  try {
    const officers = await fetchRoster();
    const config: PublicConfig = {
      today: todayFolderDate(),
      maxAttachBytes: 26_214_400,
      allowedRecipientDomain: 'yeonsung.ac.kr',
      officers,
    };
    useApp.getState().patch({ config, statusText: '' });
  } catch (error) {
    useApp.getState().patch({ config: null, statusText: messageOf(error) });
  }
}

export async function syncStoredOfficer(profile: Profile | null, officers: Officer[]): Promise<Profile | null> {
  if (!profile?.officerId || profile.role === 'admin') return profile;
  const officer = officers.find((item) => item.id === profile.officerId);
  if (!officer || !officerCanLogin(officer)) return profile;
  const name = officer.name.trim();
  const position = officer.position.trim();
  const email = (officer.email || '').trim();
  if (profile.name === name && profile.position === position && (profile.savedEmail || '') === email) return profile;
  const next = { ...profile, name, position, savedEmail: email };
  await saveProfile(next);
  return next;
}

export async function loginWithPassword(officer: Officer, password: string): Promise<void> {
  const existing = useApp.getState().profile;
  const session = await loginOfficer(officer.id, password);
  const profile = profileFromSession(session, existing?.deviceId || createDeviceId(), existing?.createdAt || new Date().toISOString());
  await saveProfile(profile);
  useApp.getState().patch({
    profile,
    showOnboarding: false,
    showPassword: session.mustChangePassword,
    passwordRequired: session.mustChangePassword,
    statusText: '',
  });
  if (session.mustChangePassword) return;
  startRemoteRefreshWatch();
  await refreshTree('load');
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  await changePassword(currentPassword, newPassword);
  const profile = useApp.getState().profile;
  if (!profile) return;
  const openAdmin = profile.role === 'admin' && useApp.getState().passwordRequired;
  const next = { ...profile, mustChangePassword: false };
  await saveProfile(next);
  useApp.getState().patch({
    profile: next,
    showPassword: false,
    passwordRequired: false,
    memoSyncText: '',
    screen: openAdmin ? 'admin' : useApp.getState().screen,
  });
  startRemoteRefreshWatch();
  await refreshTree('load');
}

export async function submitProfile(officer: Officer): Promise<void> {
  void officer;
}

export async function refreshTree(
  reason: 'load' | 'refresh' | 'preload',
  options?: { expandMeeting?: boolean; background?: boolean; quiet?: boolean; retryMissing?: boolean },
): Promise<boolean> {
  if (useApp.getState().profile?.mustChangePassword) return false;
  if (!navigator.onLine) {
    useTree.getState().patch({ folders: [], loading: false });
    if (!options?.quiet) useApp.getState().patch({ statusText: '서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.', online: false });
    return false;
  }
  if (!options?.background) {
    useTree.getState().patch({ loading: true });
    useApp.getState().patch({ statusText: '자료 폴더를 확인하는 중…' });
  }
  meetingPreloadRunning = true;
  lastWarm = { saved: 0, failed: 0 };
  try {
    const data = await bootFromServer();
    const config = data.config;
    const folders = sortDriveTree(data.tree.folders);
    const fetchedAt = data.tree.fetchedAt;
    const previous = await loadTreeCache();
    const diff = diffTrees(previous?.root ?? null, folders);
    await applyReplacements(previous?.root ?? [], folders, diff.replaced);
    const announced = diff.replaced.filter((item) => item.sameName);
    const seenFolderIds = previous?.seenFolderIds ?? [];
    const seenFileIds = previous?.seenFileIds ?? [];
    const today = config.today || todayFolderDate();
    const expanded = reason === 'load' ? expandedForToday(folders, today) : { ...useTree.getState().expanded };
    if (options?.expandMeeting && config.meetingDate) {
      const meetingFolder = folders.find((folder) => folder.dateKey === config.meetingDate);
      if (meetingFolder) expanded[meetingFolder.id] = true;
    }
    await saveTreeCache({ fetchedAt, root: folders, seenFolderIds, seenFileIds });
    await kvSet('expanded', expanded);
    const synced = await syncStoredOfficer(useApp.getState().profile, config.officers || []);
    const viewer = synced ?? useApp.getState().profile;
    const alertChange = showFileChangeAlert(viewer?.role) && announced.length > 0;
    useTree.getState().patch({
      folders,
      loading: false,
      expanded,
      newFolderIds: [],
      newFileIds: [],
      replacedIds: alertChange ? announced.map((item) => item.nextId) : [],
      seenFolderIds,
      seenFileIds,
    });
    applyChangeNotices(config.changeNotices);
    useApp.getState().patch({
      config,
      profile: viewer,
      lastFetchedAt: fetchedAt,
      statusText: '',
      online: true,
      drawerOpen: alertChange && options?.expandMeeting ? true : useApp.getState().drawerOpen,
      ...(alertChange
        ? {
            replaceNotice: `자료가 바뀌었음 — ${announced.map((item) => item.path).join(', ')}. 기존 메모를 같은 위치로 옮겼습니다.`,
          }
        : {}),
    });
    await finishMeetingSchedule(options?.retryMissing);
    if (lastWarm.failed === 0) missingRetryLeft = 0;
    publishedWarm = lastWarm;
    if (typeof data.tree.treeRefreshAt === 'string') appliedTreeRefreshAt = data.tree.treeRefreshAt;
    void pollRemoteRefresh();
    return true;
  } catch (error) {
    useTree.getState().patch({ loading: false, folders: [] });
    publishedWarm = lastWarm;
    if (!options?.quiet) useApp.getState().patch({ statusText: messageOf(error) });
    if (options?.retryMissing) scheduleMissingRetry();
    return false;
  } finally {
    meetingPreloadRunning = false;
    const waiting = pendingRemoteAt;
    if (waiting && remoteRefreshAction(appliedTreeRefreshAt, waiting, '') === 'run') {
      void runRemoteRefresh(waiting);
    }
  }
}

function startRemoteRefreshWatch(): void {
  if (remoteWatchStarted || typeof window === 'undefined') return;
  remoteWatchStarted = true;
  window.setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void pollRemoteRefresh();
  }, REMOTE_REFRESH_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pollRemoteRefresh();
  });
}

async function pollRemoteRefresh(): Promise<void> {
  if (!navigator.onLine || remotePollInflight || !useApp.getState().profile || useApp.getState().profile?.mustChangePassword) return;
  remotePollInflight = true;
  try {
    const data = await pulseServer();
    applyChangeNotices(data.changeNotices);
    const incoming = data.treeRefreshAt || '';
    if (remoteRefreshAction(appliedTreeRefreshAt, incoming, pendingRemoteAt) !== 'run') return;
    pendingRemoteAt = incoming;
    if (remoteRefreshDelayTimer) window.clearTimeout(remoteRefreshDelayTimer);
    const wait = preloadStaggerMs(useApp.getState().profile?.deviceId || createDeviceId());
    remoteRefreshDelayTimer = window.setTimeout(() => {
      remoteRefreshDelayTimer = 0;
      void runRemoteRefresh(incoming);
    }, wait);
  } catch {
    /* 다음 주기에 다시 확인한다. */
  } finally {
    remotePollInflight = false;
  }
}

async function runRemoteRefresh(at: string): Promise<void> {
  if (remoteRefreshAction(appliedTreeRefreshAt, at, '') !== 'run') {
    if (pendingRemoteAt === at) pendingRemoteAt = '';
    return;
  }
  if (meetingPreloadRunning) return;
  if (pendingRemoteAt === at) pendingRemoteAt = '';
  missingRetryLeft = 2;
  const ok = await refreshTree('refresh', { background: true, quiet: true, retryMissing: true });
  if (ok) useApp.getState().toast(remoteRefreshNotice(publishedWarm.saved, publishedWarm.failed));
}

export async function requestConnectedRefresh(): Promise<void> {
  const data = await requestMaterialRefresh();
  if (data.treeRefreshAt) appliedTreeRefreshAt = data.treeRefreshAt;
  pendingRemoteAt = '';
  if (remoteRefreshDelayTimer) {
    window.clearTimeout(remoteRefreshDelayTimer);
    remoteRefreshDelayTimer = 0;
  }
  missingRetryLeft = 2;
  useApp.getState().toast('접속 중인 화면에 자료 새로고침을 요청했습니다.');
  void refreshTree('refresh', { retryMissing: true }).then((ok) => {
    if (ok && (publishedWarm.saved > 0 || publishedWarm.failed > 0)) {
      useApp.getState().toast(remoteRefreshNotice(publishedWarm.saved, publishedWarm.failed));
    }
  });
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
      markStored(change.previousId, false);
      if (change.nextId !== change.previousId) markStored(change.nextId, false);
    }
  }
}

function expandedForToday(folders: DateFolder[], today = todayFolderDate()): Record<string, boolean> {
  const todayFolder = folders.find((folder) => folder.folderDate === today);
  return todayFolder ? { [todayFolder.id]: true } : {};
}

function scheduleMissingRetry(): void {
  if (missingRetryTimer || missingRetryLeft <= 0) return;
  missingRetryLeft -= 1;
  missingRetryTimer = window.setTimeout(() => {
    missingRetryTimer = 0;
    void refreshTree('refresh', { background: true, quiet: true, retryMissing: true });
  }, 15_000);
}

async function pdfIsCached(node: DriveNode): Promise<boolean> {
  const local = await getFile(node.id);
  if (!pdfBytesCurrent(node, local) || !local?.currentBlobKey) return false;
  return Boolean(await getPdfBlob(local.currentBlobKey));
}

async function warmMissingPdfs(): Promise<void> {
  const pending: DriveNode[] = [];
  const targets = preloadPdfNodes(useTree.getState().folders, 'meeting', useApp.getState().config?.meetingDate);
  for (const node of targets) {
    if (!(await pdfIsCached(node))) pending.push(node);
  }
  if (!pending.length) return;
  const label = '회의 자료를 받아 두는 중…';
  let saved = 0;
  let failed = 0;
  let failedError: unknown;
  for (let index = 0; index < pending.length; index += 1) {
    useApp.getState().patch({ statusText: `${label} ${index + 1}/${pending.length}` });
    try {
      await ensurePdf(pending[index]);
      if (await pdfIsCached(pending[index])) saved += 1;
      else {
        failed += 1;
        failedError = new Error('자료를 받지 못했습니다.');
      }
    } catch (error) {
      failed += 1;
      failedError = error;
    }
  }
  lastWarm = { saved, failed };
  if (useApp.getState().statusText.startsWith(label)) {
    useApp.getState().patch({ statusText: '' });
  }
  if (failedError) throw failedError;
}

async function finishMeetingSchedule(retryMissing = false): Promise<void> {
  try {
    await warmMissingPdfs();
  } catch (error) {
    useApp.getState().patch({ statusText: messageOf(error) });
    if (retryMissing) scheduleMissingRetry();
  }
}

/** 회의 시각에 맞춘 자동 확인은 하지 않는다. */
export function armMeetingRefresh(): void {
  /* 로그인과 관리자 새로고침만 목록을 다시 받는다. */
}

async function openPdfDocument(bytes: Uint8Array) {
  const pdf = await import('./pdf');
  return pdf.openPdfDocument(bytes);
}

function isMeetingFile(node: DriveNode): boolean {
  const meetingDate = useApp.getState().config?.meetingDate;
  const folderDate = meetingDate ? dateKeyToFolderDate(meetingDate) : null;
  if (!folderDate) return false;
  return node.path === folderDate || node.path.startsWith(`${folderDate}/`);
}

let openToken = 0;
let sideToken = 0;

function releaseDoc(doc: { destroy?: () => Promise<void> } | null | undefined): void {
  if (!doc || typeof doc.destroy !== 'function') return;
  void doc.destroy().catch(() => undefined);
}

async function rememberOpened(node: DriveNode): Promise<void> {
  const seen = new Set(useTree.getState().seenFileIds);
  seen.add(node.id);
  useTree.getState().patch({ seenFileIds: [...seen] });
  const cache = await loadTreeCache();
  if (cache) await saveTreeCache({ ...cache, seenFileIds: [...seen] });
  await track('열람', node.path.split('/')[0], node.path);
}

export async function openPdf(node: DriveNode, readOnly = false, page = 1): Promise<void> {
  if (!node.isPdf) return;
  const token = ++openToken;
  useViewer.getState().patch({ loading: true, file: node, readOnly, viewingKey: '' });
  useTree.getState().patch({ selectedId: node.id });
  useApp.getState().patch({ drawerOpen: false });
  try {
    const bytes = await ensurePdf(node);
    const doc = await openPdfDocument(bytes);
    if (token !== openToken) {
      releaseDoc(doc);
      return;
    }
    const folderDate = node.path.split('/')[0] || '';
    const incoming = await annotationsForOpen(node);
    const local = await getFile(node.id);
    if (token !== openToken) {
      releaseDoc(doc);
      return;
    }
    if (local) await upsertFile({ ...local, pageCount: doc.numPages, lastOpenedAt: new Date().toISOString() });
    if (token !== openToken) {
      releaseDoc(doc);
      return;
    }
    useViewer.getState().patch({
      doc,
      page,
      pageCount: doc.numPages,
      loading: false,
      local: local ?? null,
      fit: 'width',
    });
    useMemoStore.getState().patch({
      items: mergeFolderAnnotations(useMemoStore.getState().items, incoming, folderDate, node.id),
      editorId: null,
    });
    await rememberOpened(node);
  } catch (error) {
    if (token !== openToken) return;
    useViewer.getState().patch({ loading: false });
    useApp.getState().toast(messageOf(error));
  }
}

export function closeOpenPdf(): void {
  openToken += 1;
  const doc = useViewer.getState().doc;
  useViewer.getState().patch({
    file: null,
    local: null,
    doc: null,
    page: 1,
    pageCount: 0,
    loading: false,
    readOnly: false,
    viewingKey: '',
    findOpen: false,
    findQuery: '',
    findHitQuery: '',
    findHits: [],
    findIndex: -1,
    findTick: 0,
  });
  useMemoStore.getState().patch({ activeId: null, editorId: null });
  releaseDoc(doc);
}

export async function openSidePdf(node: DriveNode): Promise<void> {
  if (!node.isPdf) return;
  const token = ++sideToken;
  const previous = useSplit.getState().doc;
  useSplit.getState().patch({ loading: true, file: node, fit: 'width', doc: null, page: 1, pageCount: 0 });
  try {
    const bytes = await ensurePdf(node);
    const doc = await openPdfDocument(bytes);
    if (token !== sideToken) {
      releaseDoc(doc);
      releaseDoc(previous);
      return;
    }
    releaseDoc(previous);
    useSplit.getState().patch({
      doc,
      page: 1,
      pageCount: doc.numPages,
      zoom: 1,
      fit: 'width',
      loading: false,
    });
    const folderDate = node.path.split('/')[0] || '';
    const incoming = await annotationsForOpen(node);
    if (token !== sideToken) return;
    const memo = useMemoStore.getState();
    const items = mergeFolderAnnotations(memo.items, incoming, folderDate, node.id);
    const editorGone = Boolean(memo.editorId) && !items.some((item) => item.id === memo.editorId);
    memo.patch({
      items,
      ...(editorGone ? { editorId: null, activeId: null } : {}),
    });
    await rememberOpened(node);
  } catch (error) {
    if (token !== sideToken) return;
    useSplit.getState().patch({ loading: false });
    useApp.getState().toast(messageOf(error));
  }
}

export function closeSidePdf(): void {
  sideToken += 1;
  const doc = useSplit.getState().doc;
  useSplit.getState().patch({
    file: null,
    doc: null,
    page: 1,
    pageCount: 0,
    zoom: 1,
    fit: 'width',
    loading: false,
  });
  releaseDoc(doc);
}

export async function openStoredVersion(blobKey: string): Promise<void> {
  const { file, local } = useViewer.getState();
  if (!file?.isPdf || !local) return;
  const fileId = file.id;
  try {
    const bytes = blobKey ? await bytesForVersion(local, blobKey) : await ensurePdf(file);
    if (!bytes || useViewer.getState().file?.id !== fileId) return;
    const doc = await openPdfDocument(bytes);
    if (useViewer.getState().file?.id !== fileId) return;
    useViewer.getState().patch({
      doc,
      page: 1,
      pageCount: doc.numPages,
      readOnly: Boolean(blobKey),
      viewingKey: blobKey,
      loading: false,
    });
  } catch (error) {
    if (useViewer.getState().file?.id === fileId) useApp.getState().toast(messageOf(error));
  }
}

async function bytesForVersion(local: LocalFile, blobKey: string): Promise<Uint8Array | null> {
  const version = local.versions.find((item) => item.blobKey === blobKey);
  if (!version) return null;
  const stored = await getPdfBlob(version.blobKey);
  if (!stored) {
    useApp.getState().toast('이 기기에 그 시점의 파일이 없습니다.');
    return null;
  }
  return new Uint8Array(await stored.blob.arrayBuffer());
}

export async function setChangeNotice(node: DriveNode, enabled: boolean): Promise<void> {
  const current = useTree.getState().changeNotices.filter((item) => item.fileId !== node.id);
  applyChangeNotices(enabled ? [...current, { fileId: node.id, path: node.path }] : current);
  useApp.getState().toast(enabled ? '이 파일의 변경 표시를 이 화면에 남겼습니다.' : '이 파일의 변경 표시를 숨겼습니다.');
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
  if (cached && (isMeetingFile(node) || (await remotePdfMatches(node)))) return cached;
  return pdfDownloadQueue.run(() => downloadPdf(node, true));
}

async function remotePdfMatches(node: DriveNode): Promise<boolean> {
  if (!navigator.onLine) return false;
  const local = await getFile(node.id);
  if (!local) return false;
  try {
    const meta = await materialMeta(node.id);
    return pdfBytesCurrent(meta, local);
  } catch {
    return false;
  }
}

async function readCachedPdf(node: DriveNode): Promise<Uint8Array | null> {
  const local = await getFile(node.id);
  if (!pdfBytesCurrent(node, local) || !local?.currentBlobKey) return null;
  const blob = await getPdfBlob(local.currentBlobKey);
  if (!blob) return null;
  return new Uint8Array(await blob.blob.arrayBuffer());
}

async function downloadPdf(node: DriveNode, force = false): Promise<Uint8Array> {
  const local = await getFile(node.id);
  if (!force && pdfBytesCurrent(node, local) && local?.currentBlobKey) {
    const blob = await getPdfBlob(local.currentBlobKey);
    if (blob) return new Uint8Array(await blob.blob.arrayBuffer());
  }
  if (!navigator.onLine) throw new NetworkError('서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.');
  const data = await materialFile(node.id);
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
  markStored(node.id, true);
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
  markStored(victim.driveFileId, false);
}

async function localFileMap(): Promise<Record<string, true>> {
  const localFiles: Record<string, true> = {};
  for (const file of await listFiles()) {
    if (file.currentBlobKey) localFiles[file.driveFileId] = true;
  }
  return localFiles;
}

function markStored(id: string, present: boolean): void {
  const current = useTree.getState().localFiles;
  if (Boolean(current[id]) === present) return;
  const localFiles = { ...current };
  if (present) localFiles[id] = true;
  else delete localFiles[id];
  useTree.getState().patch({ localFiles, localVersion: useTree.getState().localVersion + 1 });
}

export async function saveMemo(ann: Annotation, action: 'create' | 'update' | 'delete' | 'restore'): Promise<void> {
  await writeAnnotation(ann, action);
  const incoming = await memosInFolder(ann.folderDate, ann.driveFileId);
  useMemoStore.getState().patch({
    items: mergeFolderAnnotations(useMemoStore.getState().items, incoming, ann.folderDate, ann.driveFileId),
  });
  queueMemoSync(ann);
  void scheduleBackup();
}

export async function removeMemo(ann: Annotation): Promise<void> {
  const deleted = { ...ann, status: 'deleted' as const, version: ann.version + 1, updatedAt: new Date().toISOString() };
  await writeAnnotation(deleted, 'delete');
  queueMemoSync(deleted);
  await deleteAnnotation(ann.id);
  const incoming = await memosInFolder(ann.folderDate, ann.driveFileId);
  const store = useMemoStore.getState();
  store.patch({
    items: mergeFolderAnnotations(store.items, incoming, ann.folderDate, ann.driveFileId).filter((item) => item.id !== ann.id),
    ...(store.activeId === ann.id ? { activeId: null } : {}),
    ...(store.editorId === ann.id ? { editorId: null } : {}),
  });
  void scheduleBackup();
}

export async function clearFileMarks(driveFileId: string): Promise<number> {
  const targets = marksToClear(useMemoStore.getState().items, driveFileId);
  if (!targets.length) return 0;
  const updatedAt = new Date().toISOString();
  for (const ann of targets) {
    const deleted = { ...ann, status: 'deleted' as const, version: ann.version + 1, updatedAt };
    await writeAnnotation(deleted, 'delete');
    queueMemoSync(deleted);
  }
  const folderDate = targets[0].folderDate;
  const incoming = await memosInFolder(folderDate, driveFileId);
  useMemoStore.getState().patch({
    items: mergeFolderAnnotations(useMemoStore.getState().items, incoming, folderDate, driveFileId),
  });
  void scheduleBackup();
  return targets.length;
}

function memosInFolder(folderDate: string, driveFileId: string): Promise<Annotation[]> {
  if (folderDate) return listAnnotationsByFolder(folderDate);
  return listAnnotationsByFile(driveFileId);
}

function mergeFolderAnnotations(current: Annotation[], incoming: Annotation[], folderDate: string, driveFileId: string): Annotation[] {
  const kept = folderDate
    ? current.filter((item) => item.folderDate !== folderDate)
    : current.filter((item) => item.driveFileId !== driveFileId);
  return [...kept, ...incoming];
}

export async function track(action = '열람', folderDate = '', target = ''): Promise<void> {
  await logAccess(action, target || folderDate);
}

export async function flushOutbox(): Promise<void> {
  await flushPendingMemos();
}

export async function loginAdmin(password: string): Promise<void> {
  const previous = useApp.getState().profile;
  const enteredFromGate = !previous?.name;
  try {
    const session = await loginAdminAccount(password);
    const next = profileFromSession(session, previous?.deviceId || createDeviceId(), previous?.createdAt || new Date().toISOString());
    await saveProfile(next);
    useApp.getState().patch({
      profile: next,
      showAdminConvert: false,
      showOnboarding: false,
      showPassword: session.mustChangePassword,
      passwordRequired: session.mustChangePassword,
      menuOpen: false,
      screen: session.mustChangePassword ? 'main' : enteredFromGate ? 'admin' : useApp.getState().screen,
    });
    if (session.mustChangePassword) return;
    useApp.getState().toast('관리자로 전환했습니다.');
    await refreshTree('load');
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
  await logoutSession();
  await clearProfile();
  useTree.getState().patch({ folders: [] });
  useApp.getState().patch({
    profile: null,
    screen: 'main',
    showOnboarding: true,
    showAdminConvert: false,
    showPassword: false,
    passwordRequired: false,
    menuOpen: false,
    memoSyncText: '',
  });
  await loadPublicConfig();
}

let backupTimer = 0;
function scheduleBackup(): void {
  if (backupTimer) window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => {
    void import('./backupFlow').then((mod) => mod.autoBackup());
  }, 120_000);
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
