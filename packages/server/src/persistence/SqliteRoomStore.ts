import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';
import { migrateState, type GameState, type SnapshotInfo, type SnapshotReason } from '@vtt/shared';
import type { RoomStore } from './RoomStore';

const gzipAsync = promisify(gzip);

/**
 * Database schema migrations, applied in order and tracked with
 * `PRAGMA user_version`. Never edit an existing entry; append a new one.
 *
 * Room state is stored as JSON text (readable with the sqlite3 CLI);
 * snapshots are gzipped JSON to keep history cheap.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE rooms (
     id             TEXT PRIMARY KEY,
     schema_version INTEGER NOT NULL,
     state          TEXT NOT NULL,
     created_at     INTEGER NOT NULL,
     updated_at     INTEGER NOT NULL
   );
   CREATE TABLE room_snapshots (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     room_id        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
     created_at     INTEGER NOT NULL,
     reason         TEXT NOT NULL,
     label          TEXT,
     schema_version INTEGER NOT NULL,
     state          BLOB NOT NULL
   );
   CREATE INDEX room_snapshots_by_room ON room_snapshots(room_id, created_at DESC);`,
];

interface SnapshotRow {
  id: number;
  room_id: string;
  created_at: number;
  reason: SnapshotReason;
  label: string | null;
  size: number;
}

function toInfo(r: SnapshotRow): SnapshotInfo {
  return { id: r.id, roomId: r.room_id, createdAt: r.created_at, reason: r.reason, label: r.label, sizeBytes: r.size };
}

export class SqliteRoomStore implements RoomStore {
  private readonly db: DatabaseSync;
  private readonly stmt: Record<
    'load' | 'upsert' | 'rooms' | 'snapInsert' | 'snapList' | 'snapGet' | 'snapDelete',
    StatementSync
  >;

  constructor(readonly file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    this.migrate();
    this.stmt = {
      load: this.db.prepare('SELECT state FROM rooms WHERE id = ?'),
      upsert: this.db.prepare(`
        INSERT INTO rooms (id, schema_version, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, state = excluded.state, updated_at = excluded.updated_at`),
      rooms: this.db.prepare(`
        SELECT r.id, r.created_at, r.updated_at, (SELECT count(*) FROM room_snapshots s WHERE s.room_id = r.id) AS snapshots
        FROM rooms r ORDER BY r.updated_at DESC`),
      snapInsert: this.db.prepare(`
        INSERT INTO room_snapshots (room_id, created_at, reason, label, schema_version, state) VALUES (?, ?, ?, ?, ?, ?)`),
      snapList: this.db.prepare(`
        SELECT id, room_id, created_at, reason, label, length(state) AS size
        FROM room_snapshots WHERE room_id = ? ORDER BY created_at DESC, id DESC`),
      snapGet: this.db.prepare('SELECT state FROM room_snapshots WHERE room_id = ? AND id = ?'),
      snapDelete: this.db.prepare('DELETE FROM room_snapshots WHERE id = ?'),
    };
  }

  private migrate() {
    const { user_version: current } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (current > MIGRATIONS.length) {
      throw new Error(`Database schema v${current} is newer than this server understands (v${MIGRATIONS.length})`);
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
      console.log(`[db] migrated database to schema v${v + 1}`);
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async load(roomId: string): Promise<GameState | null> {
    const row = this.stmt.load.get(roomId) as { state: string } | undefined;
    // Throws on corrupt/invalid data rather than silently starting a fresh room.
    return row ? migrateState(JSON.parse(row.state)) : null;
  }

  async save(roomId: string, state: GameState): Promise<void> {
    const now = Date.now();
    this.stmt.upsert.run(roomId, state.schemaVersion, JSON.stringify(state), now, now);
  }

  async listRooms() {
    return (this.stmt.rooms.all() as { id: string; created_at: number; updated_at: number; snapshots: number }[]).map(
      (r) => ({ id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, snapshots: r.snapshots }),
    );
  }

  async createSnapshot(roomId: string, state: GameState, reason: SnapshotReason, label: string | null) {
    const json = JSON.stringify(state);
    const blob = await gzipAsync(json);
    const createdAt = Date.now();
    const id = this.transaction(() => {
      // Snapshots reference the room row; make sure it exists.
      if (!this.stmt.load.get(roomId)) {
        this.stmt.upsert.run(roomId, state.schemaVersion, json, createdAt, createdAt);
      }
      return Number(this.stmt.snapInsert.run(roomId, createdAt, reason, label, state.schemaVersion, blob).lastInsertRowid);
    });
    return { id, roomId, createdAt, reason, label, sizeBytes: blob.length };
  }

  async listSnapshots(roomId: string): Promise<SnapshotInfo[]> {
    return (this.stmt.snapList.all(roomId) as unknown as SnapshotRow[]).map(toInfo);
  }

  async loadSnapshot(roomId: string, snapshotId: number): Promise<GameState | null> {
    const row = this.stmt.snapGet.get(roomId, snapshotId) as { state: Uint8Array } | undefined;
    return row ? migrateState(JSON.parse(gunzipSync(row.state).toString('utf8'))) : null;
  }

  async deleteSnapshots(ids: number[]): Promise<void> {
    if (!ids.length) return;
    this.transaction(() => {
      for (const id of ids) this.stmt.snapDelete.run(id);
    });
  }

  /** Consistent copy of the whole database, safe while the server is running. */
  backupTo(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) throw new Error(`${file} already exists`);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }
}
