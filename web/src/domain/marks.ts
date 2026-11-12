import type { Annotation } from '../api/types';

export function marksToClear(items: Annotation[], driveFileId: string): Annotation[] {
  if (!driveFileId) return [];
  return items.filter((ann) => ann.driveFileId === driveFileId && ann.status === 'active' && ann.type !== 'pin');
}
