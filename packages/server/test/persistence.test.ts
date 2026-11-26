import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createInitialState, CURRENT_SCHEMA_VERSION, migrateState, newId, type GameState, type SnapshotInfo } from '@vtt/shared';
import { importLegacyRooms } from '../src/persistence/importLegacy';
import { snapshotsToPrune, shouldAutoSnapshot, type SnapshotPolicy } from '../src/persistence/snapshotPolicy';
import { SqliteRoomStore } from '../src/persistence/SqliteRoomStore';

let dir: string;
let store: SqliteRoomStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-test-'));
  store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function sampleState(): GameState {
  const s = createInitialState(newId());
  s.users.u1 = { id: 'u1', name: 'Dana', role: 'gm', color: '#ff0000' };
  return s;
}

/** A state as the pre-drawings/notes/loot (v1) store saved it. */
function v1State() {
  const { drawings: _d, notes: _n, loot: _l, ...rest } = sampleState();
  return { ...rest, schemaVersion: 1 };
}

describe('SqliteRoomStore', () => {
  test('save/load round trip', async () => {
    assert.equal(await store.load('main'), null);
    const s = sampleState();
    await store.save('main', s);
    assert.deepEqual(await store.load('main'), s);
    s.chat.push({ id: 'm1', userId: 'u1', ts: 1, text: 'hi' });
    await store.save('main', s);
    assert.equal((await store.load('main'))!.chat.length, 1);
  });

  test('persists across reopen', async () => {
    await store.save('main', sampleState());
    store.close();
    store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
    assert.ok(await store.load('main'));
  });

  test('migrates old-schema state on load', async () => {
    const db = store as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): void } } };
    db.db
      .prepare('INSERT INTO rooms (id, schema_version, state, created_at, updated_at) VALUES (?, 1, ?, 0, 0)')
      .run('old', JSON.stringify(v1State()));
    const loaded = await store.load('old');
    assert.equal(loaded!.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(loaded!.loot, {});
  });

  test('refuses corrupt room data instead of starting fresh', async () => {
    const db = store as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): void } } };
    db.db.prepare("INSERT INTO rooms (id, schema_version, state, created_at, updated_at) VALUES ('bad', 2, '{\"nope\":1}', 0, 0)").run();
    await assert.rejects(store.load('bad'));
  });

  test('snapshots: create, list newest first, load, delete', async () => {
    const s = sampleState();
    await store.save('main', s);
    const a = await store.createSnapshot('main', s, 'auto', null);
    s.users.u1!.name = 'Changed';
    const b = await store.createSnapshot('main', s, 'manual', 'before boss');
    const list = await store.listSnapshots('main');
    assert.deepEqual(
      list.map((x) => x.id),
      [b.id, a.id],
    );
    assert.equal(list[0]!.label, 'before boss');
    assert.ok(list[0]!.sizeBytes > 0);
    assert.equal((await store.loadSnapshot('main', a.id))!.users.u1!.name, 'Dana');
    assert.equal(await store.loadSnapshot('other', a.id), null, 'snapshots are scoped to their room');
    await store.deleteSnapshots([a.id]);
    assert.equal((await store.listSnapshots('main')).length, 1);
  });

  test('snapshot of an unsaved room creates the room row', async () => {
    await store.createSnapshot('fresh', sampleState(), 'manual', null);
    assert.ok(await store.load('fresh'));
  });

  test('backup produces a usable database copy', async () => {
    await store.save('main', sampleState());
    const file = path.join(dir, 'backups', 'copy.db');
    store.backupTo(file);
    const copy = new SqliteRoomStore(file);
    assert.ok(await copy.load('main'));
    copy.close();
    assert.throws(() => store.backupTo(file), /already exists/);
  });
});

describe('state migrations', () => {
  test('v2 -> v3 adds vision/fog to scenes and hp/conditions to tokens', () => {
    const v2 = {
      schemaVersion: 2,
      users: {},
      scenes: {
        s1: {
          id: 's1', name: 'Cave', width: 700, height: 700, background: null, backgroundColor: '#000000',
          grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.3, unitsPerCell: 5, unitLabel: 'ft', diagonals: 'alternating', snap: true },
        },
      },
      sceneOrder: ['s1'],
      activeSceneId: 's1',
      tokens: {
        t1: { id: 't1', sceneId: 's1', name: 'Hero', imageUrl: null, color: '#ff0000', x: 0, y: 0, size: 1, ownerIds: [], hidden: false, showName: true },
      },
      drawings: {}, chat: [], notes: {}, loot: {},
    };
    const s = migrateState(v2);
    assert.equal(s.schemaVersion, 3);
    assert.deepEqual(s.scenes.s1!.fog, { enabled: false, ops: [] });
    assert.equal(s.tokens.t1!.hp, null);
    assert.deepEqual(s.tokens.t1!.conditions, []);
    assert.equal(s.combat.currentId, null);
    assert.deepEqual(s.decks, {});
  });
});

describe('importLegacyRooms', () => {
  test('imports JSON rooms once, renames files, keeps a snapshot', async () => {
    const roomsDir = path.join(dir, 'rooms');
    fs.mkdirSync(roomsDir);
    fs.writeFileSync(path.join(roomsDir, 'main.json'), JSON.stringify(v1State()));
    fs.writeFileSync(path.join(roomsDir, 'broken.json'), '{ not json');

    assert.deepEqual(await importLegacyRooms(store, roomsDir), ['main']);
    assert.equal((await store.load('main'))!.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal((await store.listSnapshots('main'))[0]!.reason, 'import');
    assert.ok(fs.existsSync(path.join(roomsDir, 'main.json.imported')));
    assert.ok(fs.existsSync(path.join(roomsDir, 'broken.json')), 'unreadable files are left untouched');

    assert.deepEqual(await importLegacyRooms(store, roomsDir), [], 'second run imports nothing');
  });

  test('never overwrites a room already in the database', async () => {
    const roomsDir = path.join(dir, 'rooms');
    fs.mkdirSync(roomsDir);
    const current = sampleState();
    current.users.u1!.name = 'In database';
    await store.save('main', current);
    fs.writeFileSync(path.join(roomsDir, 'main.json'), JSON.stringify(v1State()));
    assert.deepEqual(await importLegacyRooms(store, roomsDir), []);
    assert.equal((await store.load('main'))!.users.u1!.name, 'In database');
    assert.ok(fs.existsSync(path.join(roomsDir, 'main.json')));
  });

  test('missing directory is fine', async () => {
    assert.deepEqual(await importLegacyRooms(store, path.join(dir, 'nope')), []);
  });
});

describe('snapshot policy', () => {
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const policy: SnapshotPolicy = { autoIntervalMs: HOUR, keepAllForMs: 2 * DAY, keepDailyForMs: 30 * DAY };
  const now = Date.UTC(2026, 10, 25, 12);
  let nextId = 1;
  const snap = (ageMs: number, reason: SnapshotInfo['reason'] = 'auto'): SnapshotInfo => ({
    id: nextId++,
    roomId: 'main',
    createdAt: now - ageMs,
    reason,
    label: null,
    sizeBytes: 1,
  });

  test('auto snapshot only when the newest is old enough', () => {
    assert.equal(shouldAutoSnapshot(undefined, now, policy), true);
    assert.equal(shouldAutoSnapshot(snap(30 * 60_000), now, policy), false);
    assert.equal(shouldAutoSnapshot(snap(HOUR), now, policy), true);
  });

  test('keeps recent, thins to daily, drops old, never drops manual', () => {
    const recent = [snap(HOUR), snap(10 * HOUR), snap(47 * HOUR)];
    // Three snapshots on the same day 5 days ago: only the newest survives.
    const day5 = [snap(5 * DAY), snap(5 * DAY + HOUR), snap(5 * DAY + 2 * HOUR)];
    const ancient = snap(40 * DAY);
    const manualAncient = snap(400 * DAY, 'manual');
    const pruned = snapshotsToPrune([...recent, ...day5, ancient, manualAncient], now, policy);
    assert.deepEqual(new Set(pruned), new Set([day5[1]!.id, day5[2]!.id, ancient.id]));
  });
});
