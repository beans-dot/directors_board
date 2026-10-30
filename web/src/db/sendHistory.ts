import type { SendRecord } from '../api/types';
import { getDB } from './schema';

export async function addSendRecord(record: SendRecord): Promise<void> {
  const db = await getDB();
  await db.add('sendHistory', record);
}

export async function listSendRecords(): Promise<SendRecord[]> {
  const db = await getDB();
  const rows = await db.getAll('sendHistory');
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}
