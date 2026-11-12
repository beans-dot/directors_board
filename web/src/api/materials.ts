import type {
  Annotation,
  DateFolder,
  FilePayload,
  MeetingFolderRef,
  LoginLock,
  Officer,
  PublicConfig,
} from './types';
import { bytesToBase64 } from '../services/bytes';

const BASE = '/materials-api';

interface ApiOk<T> {
  ok: true;
  data: T;
}

interface ApiFail {
  ok: false;
  error?: { code?: string; message?: string };
  data?: { server?: Annotation };
}

export class MemoConflictError extends Error {
  server: Annotation;

  constructor(server: Annotation) {
    super('다른 화면에서 이 메모를 먼저 저장했습니다.');
    this.name = 'MemoConflictError';
    this.server = server;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let json: ApiOk<T> | ApiFail;
  try {
    json = (await response.json()) as ApiOk<T> | ApiFail;
  } catch {
    throw new Error('서버 응답이 올바르지 않습니다.');
  }
  if (!json.ok) {
    if (response.status === 409 && json.data?.server) throw new MemoConflictError(json.data.server);
    throw new Error(json.error?.message || '서버가 요청을 거절했습니다.');
  }
  return json.data;
}

function requestHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('X-Depthm-Request', '1');
  return headers;
}

export async function loadMaterialTree(): Promise<{ fetchedAt: string; folders: DateFolder[] }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/tree`, { credentials: 'include' });
  } catch {
    throw new Error('서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.');
  }
  if (!response.ok && response.status !== 200) {
    const message = await response
      .json()
      .then((json: ApiFail) => json.error?.message)
      .catch(() => '');
    throw new Error(message || '서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.');
  }
  return readJson(response);
}

export async function bootFromServer(): Promise<{
  config: PublicConfig;
  tree: { fetchedAt: string; folders: DateFolder[]; treeRefreshAt?: string };
}> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/boot`, { credentials: 'include' });
  } catch {
    throw new Error('서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.');
  }
  if (!response.ok) {
    const message = await response
      .json()
      .then((json: ApiFail) => json.error?.message)
      .catch(() => '');
    throw new Error(message || '서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.');
  }
  return readJson(response);
}

export async function fetchRoster(): Promise<Officer[]> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/roster`, { credentials: 'include' });
  } catch {
    throw new Error('서버와 연결하지 못했습니다. 보직 목록을 표시하지 않습니다.');
  }
  if (!response.ok) throw new Error('보직 목록을 불러오지 못했습니다.');
  const data = await readJson<{ officers: Officer[] }>(response);
  return data.officers;
}

export interface SessionUser {
  userId: string;
  name: string;
  position: string;
  role: 'user' | 'admin';
  mustChangePassword: boolean;
}

export async function fetchSession(): Promise<SessionUser | null> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/session`, { credentials: 'include' });
  } catch {
    throw new Error('서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.');
  }
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('서버와 연결하지 못했습니다. 회의자료를 표시하지 않습니다.');
  return readJson(response);
}

export async function loginOfficer(officerId: string, password: string): Promise<SessionUser> {
  const response = await fetch(`${BASE}/login`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ officerId, password }),
  });
  return readJson(response);
}

export async function loginAdminAccount(password: string): Promise<SessionUser> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/admin/login`, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new Error('서버와 연결하지 못했습니다.');
  }
  return readJson(response);
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch(`${BASE}/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders(),
    });
  } catch {
    /* 이 기기의 화면은 닫는다. */
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await fetch(`${BASE}/password`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await readJson(response);
}

export async function listMaterialFolders(): Promise<MeetingFolderRef[] | null> {
  try {
    const tree = await loadMaterialTree();
    return tree.folders.map((folder) => ({
      folderDate: folder.folderDate,
      dateKey: folder.dateKey,
      folderId: folder.id,
      url: '',
    }));
  } catch {
    return null;
  }
}

export async function createMaterialFolder(
  dateKey: string,
  time = '09:00',
  title = '보직회의',
  options?: { folderOnly?: boolean },
): Promise<MeetingFolderRef & { existed?: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/admin/meetings`, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ dateKey, time, title, folderOnly: options?.folderOnly === true }),
    });
  } catch {
    throw new Error('자료 서버에 연결하지 못했습니다.');
  }
  return readJson(response);
}

export async function saveMaterialMeeting(payload: {
  meetingDate?: string;
  meetingTime?: string;
  meetingAuto?: boolean;
  meetingAutoWeekday?: number;
  meetingAutoTime?: string;
  clearMeeting?: boolean;
}): Promise<{
  meetingDate: string;
  meetingTime: string;
  meetingAuto: boolean;
  meetingAutoWeekday?: number;
  meetingAutoTime?: string;
}> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/admin/schedule`, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('자료 서버에 연결하지 못했습니다.');
  }
  return readJson(response);
}

export async function uploadMaterialPdf(
  file: File,
  meetingId: string,
  category: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/admin/meetings/${encodeURIComponent(meetingId)}/files`, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders({
        'Content-Type': 'application/pdf',
        'X-Category': encodeURIComponent(category),
        'X-File-Name': encodeURIComponent(file.name),
      }),
      body: file,
    });
  } catch {
    throw new Error('자료 서버에 연결하지 못했습니다.');
  }
  await readJson(response);
}

export async function replaceMaterialPdf(file: File, fileId: string): Promise<void> {
  const response = await fetch(`${BASE}/admin/files/${encodeURIComponent(fileId)}/replace`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders({
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent(file.name),
    }),
    body: file,
  });
  await readJson(response);
}

export async function deleteMaterialFolder(dateKey: string): Promise<{
  folderDate: string;
  dateKey: string;
  clearedSchedule: boolean;
  memosKept: boolean;
}> {
  const response = await fetch(`${BASE}/admin/folders/delete`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dateKey }),
  });
  return readJson(response);
}

export async function deleteMaterialFile(fileId: string): Promise<void> {
  const response = await fetch(`${BASE}/admin/files/${encodeURIComponent(fileId)}/delete`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders(),
  });
  await readJson(response);
}

export async function reorderMaterialFiles(fileIds: string[]): Promise<void> {
  const response = await fetch(`${BASE}/admin/files/order`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fileIds }),
  });
  await readJson(response);
}

export async function updateMeetingInfo(
  meetingId: string,
  time: string,
  title: string,
): Promise<void> {
  const response = await fetch(`${BASE}/admin/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ time, title }),
  });
  await readJson(response);
}

export async function saveOfficers(officers: Officer[]): Promise<Officer[]> {
  const response = await fetch(`${BASE}/admin/officers`, {
    method: 'PUT',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ officers }),
  });
  const data = await readJson<{ officers: Officer[] }>(response);
  return data.officers;
}

export async function listLoginLocks(): Promise<LoginLock[]> {
  const response = await fetch(`${BASE}/admin/login-locks`, { credentials: 'include' });
  const data = await readJson<{ locks: LoginLock[] }>(response);
  return data.locks;
}

export async function clearLoginLock(key: string): Promise<LoginLock[]> {
  const response = await fetch(`${BASE}/admin/login-locks/clear`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key }),
  });
  const data = await readJson<{ locks: LoginLock[] }>(response);
  return data.locks;
}

export async function resetOfficerPassword(officerId: string): Promise<void> {
  const response = await fetch(
    `${BASE}/admin/officers/${encodeURIComponent(officerId)}/reset-password`,
    {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders(),
    },
  );
  await readJson(response);
}

export async function saveUsageTips(usageTips: string[]): Promise<string[]> {
  const response = await fetch(`${BASE}/admin/tips`, {
    method: 'PUT',
    credentials: 'include',
    headers: requestHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ usageTips }),
  });
  const data = await readJson<{ usageTips: string[] }>(response);
  return data.usageTips;
}

export async function loadAdminHome(): Promise<{
  settings: import('./types').AdminSettings;
  devices: import('./types').DeviceRow[];
  access: import('./types').AccessRow[];
}> {
  const response = await fetch(`${BASE}/admin/home`, { credentials: 'include' });
  return readJson(response);
}

export async function requestMaterialRefresh(): Promise<{ treeRefreshAt: string }> {
  const response = await fetch(`${BASE}/admin/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders(),
  });
  return readJson(response);
}

export async function pulseServer(): Promise<{
  treeRefreshAt?: string;
  changeNotices?: unknown;
  usageTips?: string[];
}> {
  const response = await fetch(`${BASE}/pulse`, { credentials: 'include' });
  return readJson(response);
}

export async function materialMeta(
  fileId: string,
): Promise<{ md5Checksum?: string; modifiedTime?: string }> {
  const response = await fetch(`${BASE}/meta?id=${encodeURIComponent(fileId)}`, {
    credentials: 'include',
  });
  return readJson(response);
}

export async function materialFile(fileId: string): Promise<FilePayload> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/file?id=${encodeURIComponent(fileId)}`, {
      credentials: 'include',
    });
  } catch {
    throw new Error('파일을 받지 못했습니다.');
  }
  if (!response.ok) {
    const message = await response
      .json()
      .then((json: ApiFail) => json.error?.message)
      .catch(() => '');
    throw new Error(message || '파일을 받지 못했습니다.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let name = response.headers.get('X-File-Name') || '';
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep the header text */
  }
  return {
    fileId,
    name,
    mimeType: 'application/pdf',
    modifiedTime: response.headers.get('X-Modified') || '',
    md5Checksum: response.headers.get('X-Md5') || '',
    size: Number(response.headers.get('X-Size') || bytes.byteLength),
    base64: bytesToBase64(bytes),
  };
}

export async function listServerMemos(fileId: string): Promise<Annotation[]> {
  const response = await fetch(`${BASE}/memos?fileId=${encodeURIComponent(fileId)}`, {
    credentials: 'include',
  });
  const data = await readJson<{ annotations: Annotation[] }>(response);
  return data.annotations;
}

export async function putServerMemo(annotation: Annotation, force = false): Promise<Annotation> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/memos`, {
      method: 'PUT',
      credentials: 'include',
      headers: requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ annotation, force }),
    });
  } catch {
    throw new Error(
      '메모가 서버에 저장되지 않았습니다. 이 기기에 남아 있으며 연결되면 다시 저장합니다.',
    );
  }
  const data = await readJson<{ annotation: Annotation }>(response);
  return data.annotation;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadServerFile(fileId: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${BASE}/download/file?id=${encodeURIComponent(fileId)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((json: ApiFail) => json.error?.message)
      .catch(() => '');
    throw new Error(message || '자료를 내려받지 못했습니다.');
  }
  saveBlob(
    await response.blob(),
    filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackName),
  );
}

export async function downloadMeetingZip(meetingId: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${BASE}/download/meeting?id=${encodeURIComponent(meetingId)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    const message = await response
      .json()
      .then((json: ApiFail) => json.error?.message)
      .catch(() => '');
    throw new Error(message || '회의자료를 내려받지 못했습니다.');
  }
  saveBlob(
    await response.blob(),
    filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackName),
  );
}

export async function logAccess(action: string, target = ''): Promise<void> {
  try {
    await fetch(`${BASE}/log`, {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, target }),
    });
  } catch {
    /* 열람 기록 실패는 자료 열람을 막지 않는다. */
  }
}

export async function openMaterialSession(): Promise<void> {
  /* 로그인 세션이 관리자 권한을 대신합니다. */
}

export async function closeMaterialSession(): Promise<void> {
  await logoutSession();
}
