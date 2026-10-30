import type { TreeSnapshot } from '../api/types';
import { getDB } from './schema';

export async function loadTreeCache(): Promise<TreeSnapshot | null> {
  const db = await getDB();
  return (await db.get('treeCache', 'latest')) ?? null;
}

export async function saveTreeCache(snapshot: TreeSnapshot): Promise<void> {
  const db = await getDB();
  await db.put('treeCache', snapshot, 'latest');
}
