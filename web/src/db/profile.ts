import type { Profile } from '../api/types';
import { getDB } from './schema';

const LS_KEY = 'bojik.deviceId';

export function readStoredDeviceId(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function writeStoredDeviceId(id: string): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* private mode */
  }
}

export async function loadProfile(): Promise<Profile | null> {
  const db = await getDB();
  const profile = (await db.get('profile', 'me')) ?? null;
  const stored = readStoredDeviceId();
  if (profile && !stored) writeStoredDeviceId(profile.deviceId);
  if (!profile && stored) return null;
  if (profile && stored && profile.deviceId !== stored) {
    profile.deviceId = stored;
    await db.put('profile', profile, 'me');
  }
  return profile;
}

export async function clearProfile(): Promise<void> {
  const db = await getDB();
  await db.delete('profile', 'me');
}

export async function saveProfile(profile: Profile): Promise<void> {
  writeStoredDeviceId(profile.deviceId);
  const db = await getDB();
  await db.put('profile', profile, 'me');
}

export function createDeviceId(): string {
  const existing = readStoredDeviceId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeStoredDeviceId(id);
  return id;
}
