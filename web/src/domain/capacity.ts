export const MAX_ATTACH_BYTES = 26_214_400;

export function sendMode(totalBytes: number, maxAttachBytes = MAX_ATTACH_BYTES): 'attach' | 'link' {
  return totalBytes > maxAttachBytes ? 'link' : 'attach';
}

export function sendQueueLabel(ahead: number): string {
  if (ahead > 0) return `앞에 ${ahead}통이 있어 기다리는 중`;
  return '순서대로 보내는 중';
}
