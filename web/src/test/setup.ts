import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { resetDBForTests } from '../db/schema';

beforeEach(async () => {
  await resetDBForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('bojik');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});
