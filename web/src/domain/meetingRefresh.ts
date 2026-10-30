import { dateKeyToFolderDate } from './folderDate';

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const PRELOAD_LEAD_MS = 10 * 60 * 1000;
export const PRELOAD_INTERVAL_MS = 60 * 1000;
export const PRELOAD_SLOTS = 10;

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

/** Milliseconds until one minute before the meeting in Asia/Seoul. Negative after that moment. */
export function msUntilMeetingRefresh(now: Date, meetingDate: string, meetingTime: string): number | null {
  const start = meetingStartMs(meetingDate, meetingTime);
  if (start === null) return null;
  return start - PRELOAD_INTERVAL_MS - now.getTime();
}

/**
 * From 10 minutes before the meeting through 1 minute before, one slot per minute.
 * Slot 0 is 10 minutes before. Slot 9 is the last check, 1 minute before the start.
 */
export function meetingPreloadSchedule(
  now: Date,
  meetingDate: string,
  meetingTime: string,
  doneSlot: number | null,
): MeetingPreloadPlan | null {
  const start = meetingStartMs(meetingDate, meetingTime);
  if (start === null) return null;
  const open = start - PRELOAD_LEAD_MS;
  const t = now.getTime();
  if (t >= start) return { phase: 'done' };
  if (t < open) return { phase: 'wait', delayMs: open - t };
  const slot = Math.min(PRELOAD_SLOTS - 1, Math.floor((t - open) / PRELOAD_INTERVAL_MS));
  const slotStartMs = open + slot * PRELOAD_INTERVAL_MS;
  if (doneSlot !== slot) return { phase: 'run', slot, slotStartMs };
  if (slot >= PRELOAD_SLOTS - 1) return { phase: 'done' };
  return { phase: 'wait', delayMs: slotStartMs + PRELOAD_INTERVAL_MS - t };
}

/** Spreads clients that share a slot so they do not all hit Drive on the same second. */
export function preloadStaggerMs(deviceId: string): number {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i += 1) hash = (hash + deviceId.charCodeAt(i) * (i + 1)) % 20;
  return hash * 1000;
}
