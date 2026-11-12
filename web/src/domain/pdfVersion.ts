/** Label for a replaced PDF, in Korea time. */
export function pdfVersionLabel(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return `이전 ${iso.slice(0, 16).replace('T', ' ')}`;
  const text = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(parsed));
  return `이전 ${text}`;
}

/** True when the stored PDF matches the Drive file, so the bytes do not need another download. */
export function pdfBytesCurrent(
  node: { md5Checksum?: string; modifiedTime?: string },
  local: { md5?: string; modifiedTime?: string; currentBlobKey?: string } | null | undefined,
): boolean {
  if (!local?.currentBlobKey) return false;
  if (node.md5Checksum && local.md5) return node.md5Checksum === local.md5;
  if (node.md5Checksum && !local.md5) return false;
  if (node.modifiedTime && local.modifiedTime) return node.modifiedTime === local.modifiedTime;
  return !node.md5Checksum && !node.modifiedTime;
}
