/**
 * One-time import of rooms saved by the old JSON-file store
 * (`<dataDir>/rooms/<roomId>.json`). Imported files are renamed to
 * `*.json.imported` (not deleted) so they're never imported twice.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { migrateState, RoomIdSchema } from '@vtt/shared';
import type { RoomStore } from './RoomStore';

export async function importLegacyRooms(store: RoomStore, roomsDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = (await fs.readdir(roomsDir)).filter((f) => f.endsWith('.json'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }

  const imported: string[] = [];
  for (const file of files) {
    const roomId = file.slice(0, -'.json'.length);
    const full = path.join(roomsDir, file);
    try {
      if (!RoomIdSchema.safeParse(roomId).success) throw new Error('file name is not a valid room id');
      if (await store.load(roomId)) {
        console.warn(`[import] skipped ${file}: room "${roomId}" already exists in the database`);
        continue;
      }
      const state = migrateState(JSON.parse(await fs.readFile(full, 'utf8')));
      await store.save(roomId, state);
      await store.createSnapshot(roomId, state, 'import', `Imported from ${file}`);
      await fs.rename(full, `${full}.imported`);
      imported.push(roomId);
      console.log(`[import] imported room "${roomId}" from ${file}`);
    } catch (e) {
      console.error(`[import] could not import ${file}; left it untouched:`, (e as Error).message);
    }
  }
  return imported;
}
