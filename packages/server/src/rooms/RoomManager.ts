import { createInitialState, newId, NO_RULES, type RulesProvider } from '@vtt/shared';
import type { RoomStore } from '../persistence/RoomStore';
import { Room } from './Room';

export class RoomManager {
  private readonly rooms = new Map<string, Promise<Room>>();

  constructor(
    private readonly store: RoomStore,
    private readonly rules: () => RulesProvider = () => NO_RULES,
  ) {}

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
    let room: Room;
    if (saved) {
      console.log(`[rooms] loaded "${roomId}"`);
      room = new Room(roomId, saved, this.store, undefined, this.rules);
    } else {
      console.log(`[rooms] created "${roomId}"`);
      room = new Room(roomId, createInitialState(newId()), this.store, undefined, this.rules);
      await this.store.save(roomId, room.currentState);
    }
    // Snapshot at the start of a session if the last one is old.
    await room.maybeAutoSnapshot();
    return room;
  }

  async flushAll() {
    const rooms = await Promise.allSettled(this.rooms.values());
    await Promise.all(rooms.map((r) => (r.status === 'fulfilled' ? r.value.flush() : undefined)));
  }
}
