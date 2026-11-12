import { dateKeyToFolderDate } from './folderDate';

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const PRELOAD_LEAD_MS = 10 * 60 * 1000;
export const PRELOAD_INTERVAL_MS = 60 * 1000;
/** Checks at 10, 5, and 1 minutes before the meeting. */
export const PRELOAD_MARKS_MS = [PRELOAD_LEAD_MS, 5 * 60 * 1000, PRELOAD_INTERVAL_MS];

export type MeetingPreloadPlan =
  | { phase: 'wait'; delayMs: number }
  | { phase: 'run'; slot: number; slotStartMs: number }
  | { phase: 'done' };

export function meetingStartMs(meetingDate: string, meetingTime: string): number | null {
  if (!dateKeyToFolderDate(meetingDate)) return null;
  const match = HM_RE.exec(meetingTime.trim());
  if (!match) return null;
  const start = Date.parse(`${meetingDate}T${match[1]}:${match[2]}:00+09:00`);
  if (Number.isNaN(start)) return null;
  return start;
}

/** The shared zip is prepared this long after the meeting starts. */
export const PACK_DELAY_MS = 10 * 60 * 1000;

/** Milliseconds until 10 minutes after the start. Negative once that moment has passed. */
export function msUntilPack(now: Date, meetingDate: string, meetingTime: string): number | null {
  const start = meetingStartMs(meetingDate, meetingTime);
  if (start === null) return null;
  return start + PACK_DELAY_MS - now.getTime();
}

export function packIsDue(now: Date, meetingDate?: string, meetingTime?: string): boolean {
  if (!meetingDate || !meetingTime) return false;
  const wait = msUntilPack(now, meetingDate, meetingTime);
  return wait !== null && wait <= 0;
}

/** Milliseconds until one minute before the meeting in Asia/Seoul. Negative after that moment. */
export function msUntilMeetingRefresh(now: Date, meetingDate: string, meetingTime: string): number | null {
  const start = meetingStartMs(meetingDate, meetingTime);
  if (start === null) return null;
  return start - PRELOAD_INTERVAL_MS - now.getTime();
}

/**
 * Three checks: 10, 5, and 1 minutes before the start.
 * Opening during a gap runs the latest check that is already due, then waits for the next one.
 */
export function meetingPreloadSchedule(
  now: Date,
  meetingDate: string,
  meetingTime: string,
  doneSlot: number | null,
): MeetingPreloadPlan | null {
  const start = meetingStartMs(meetingDate, meetingTime);
  if (start === null) return null;
  const t = now.getTime();
  if (t >= start) return { phase: 'done' };
  const first = start - PRELOAD_MARKS_MS[0];
  if (t < first) return { phase: 'wait', delayMs: first - t };
  let slot = 0;
  for (let index = 0; index < PRELOAD_MARKS_MS.length; index += 1) {
    if (t >= start - PRELOAD_MARKS_MS[index]) slot = index;
  }
  const slotStartMs = start - PRELOAD_MARKS_MS[slot];
  if (doneSlot !== slot) return { phase: 'run', slot, slotStartMs };
  if (slot >= PRELOAD_MARKS_MS.length - 1) return { phase: 'done' };
  return { phase: 'wait', delayMs: start - PRELOAD_MARKS_MS[slot + 1] - t };
}

/** Spreads clients that share a slot so they do not all hit Drive on the same second. */
export function preloadStaggerMs(deviceId: string): number {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i += 1) hash = (hash + deviceId.charCodeAt(i) * (i + 1)) % 20;
  return hash * 1000;
}
