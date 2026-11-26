import { createInitialState, newId } from '@vtt/shared';
import type { RoomStore } from '../persistence/RoomStore';
import { Room } from './Room';

export class RoomManager {
  private readonly rooms = new Map<string, Promise<Room>>();

  constructor(private readonly store: RoomStore) {}

  /** Load (or create) a room. Concurrent callers share the same load. */
  get(roomId: string): Promise<Room> {
    let pending = this.rooms.get(roomId);
    if (!pending) {
      pending = this.load(roomId);
      this.rooms.set(roomId, pending);
      pending.catch(() => this.rooms.delete(roomId));
    }
    return pending;
  }

  private async load(roomId: string): Promise<Room> {
    const saved = await this.store.load(roomId);
    if (saved) {
      console.log(`[rooms] loaded "${roomId}"`);
      return new Room(roomId, saved, this.store);
    }
    console.log(`[rooms] created "${roomId}"`);
    const room = new Room(roomId, createInitialState(newId()), this.store);
    await this.store.save(roomId, room.snapshot);
    return room;
  }

  async flushAll() {
    const rooms = await Promise.allSettled(this.rooms.values());
    await Promise.all(rooms.map((r) => (r.status === 'fulfilled' ? r.value.flush() : undefined)));
  }
}
