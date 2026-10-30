import { getDB } from './schema';

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get('kv', key) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('kv', value, key);
}
