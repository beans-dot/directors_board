import type { OutboxEvent } from '../api/types';
import { getDB } from './schema';

export async function enqueueOutbox(event: OutboxEvent): Promise<void> {
  const db = await getDB();
  await db.add('outbox', event);
}

export async function takeOutbox(): Promise<Array<OutboxEvent & { id: number }>> {
  const db = await getDB();
  const tx = db.transaction('outbox', 'readwrite');
  const rows: Array<OutboxEvent & { id: number }> = [];
  let cursor = await tx.store.openCursor();
  while (cursor) {
    rows.push({ ...cursor.value, id: cursor.primaryKey });
    cursor = await cursor.continue();
  }
  await tx.done;
  return rows;
}

export async function clearOutbox(ids: number[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('outbox', 'readwrite');
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
}
