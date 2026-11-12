import type { ChangeNotice, Role } from '../api/types';

export function normalizeChangeNotices(raw: unknown): ChangeNotice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const notices: ChangeNotice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const fileId = String((item as { fileId?: unknown }).fileId || '').trim();
    const path = String((item as { path?: unknown }).path || '').trim();
    if (!fileId || !path || fileId.length > 200 || path.length > 400) continue;
    const key = `${fileId}\n${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notices.push({ fileId, path });
  }
  return notices;
}

export function changeNoticeMatches(notices: ChangeNotice[], file: { id: string; path: string }): boolean {
  return notices.some((item) => item.fileId === file.id || item.path === file.path);
}

/** Replacement popup and the 바뀜 mark stay on the admin screen. */
export function showFileChangeAlert(role?: Role): boolean {
  return role === 'admin';
}

/** Users see a file's version list only after an admin turns on 변경알림 for that file. */
export function showPdfVersionHistory(input: {
  role?: Role;
  notices: ChangeNotice[];
  file: { id: string; path: string } | null | undefined;
  versionCount: number;
}): boolean {
  if (!input.file || input.versionCount < 1) return false;
  if (input.role === 'admin') return true;
  return changeNoticeMatches(input.notices, input.file);
}
