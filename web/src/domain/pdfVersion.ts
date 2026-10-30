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
