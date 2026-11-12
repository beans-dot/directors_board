export const REMOTE_REFRESH_POLL_MS = 30_000;

/**
 * `wait` until a tree response has recorded the signal it already included.
 * `run` when a newer admin signal is waiting and is not already scheduled.
 */
export function remoteRefreshAction(applied: string | null, incoming: string, pending: string): 'wait' | 'ignore' | 'run' {
  if (applied === null) return 'wait';
  if (!incoming || incoming === pending || incoming <= applied) return 'ignore';
  return 'run';
}

/** What an open screen tells the user after an admin refresh finishes checking the folder. */
export function remoteRefreshNotice(saved: number, failed: number): string {
  if (failed > 0) return '자료 폴더를 확인했습니다. 받지 못한 파일이 있어 다시 받습니다.';
  if (saved > 0) return `자료 폴더를 확인하고 ${saved}개 파일을 받아 두었습니다.`;
  return '자료 폴더를 다시 확인했습니다.';
}
