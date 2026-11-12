let attemptKey = '';
let attemptId = '';

/** Same folder and address keep one id, so a retry does not send a second mail. */
export function sendAttemptId(folderId: string, to: string): string {
  const next = `${folderId}\n${to.trim()}`;
  if (!attemptId || next !== attemptKey) {
    attemptKey = next;
    attemptId = crypto.randomUUID();
  }
  return attemptId;
}

export function finishSendAttempt(): void {
  attemptKey = '';
  attemptId = '';
}
