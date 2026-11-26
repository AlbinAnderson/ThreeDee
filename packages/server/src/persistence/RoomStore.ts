import type { GameState, SnapshotInfo, SnapshotReason } from '@vtt/shared';

/**
 * Storage abstraction for rooms and their snapshots. Room logic only talks to
 * this interface, so the backing store (currently SQLite) can be swapped.
 */
export interface RoomStore {
  /** Returns null if the room has never been saved. Throws if data exists but is unreadable. */
  load(roomId: string): Promise<GameState | null>;
  save(roomId: string, state: GameState): Promise<void>;
  listRooms(): Promise<{ id: string; createdAt: number; updatedAt: number; snapshots: number }[]>;

  createSnapshot(roomId: string, state: GameState, reason: SnapshotReason, label: string | null): Promise<SnapshotInfo>;
  /** Newest first. */
  listSnapshots(roomId: string): Promise<SnapshotInfo[]>;
  /** The snapshot's state, migrated to the current schema. Null if it doesn't exist in this room. */
  loadSnapshot(roomId: string, snapshotId: number): Promise<GameState | null>;
  deleteSnapshots(ids: number[]): Promise<void>;

  close(): void;
}
