import fs from 'node:fs/promises';
import path from 'node:path';
import { migrateState, type GameState } from '@vtt/shared';

/**
 * Storage abstraction for rooms. The default stores JSON files; swap in a
 * database-backed implementation later without touching room logic.
 */
export interface RoomStore {
  /** Returns null if the room has never been saved. Throws if data exists but is unreadable. */
  load(roomId: string): Promise<GameState | null>;
  save(roomId: string, state: GameState): Promise<void>;
}

export class FileRoomStore implements RoomStore {
  constructor(private readonly dir: string) {}

  private file(roomId: string) {
    return path.join(this.dir, `${roomId}.json`);
  }

  async load(roomId: string): Promise<GameState | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(roomId), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    // Deliberately throws on corrupt/invalid data rather than silently starting
    // a fresh room that would overwrite the file on the next save.
    return migrateState(JSON.parse(raw));
  }

  async save(roomId: string, state: GameState): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(roomId);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state));
    await fs.rename(tmp, target);
  }
}
