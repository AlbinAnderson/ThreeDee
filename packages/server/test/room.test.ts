import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { chatActions, createInitialState, newId, type ServerMessage, type User } from '@vtt/shared';
import { SqliteRoomStore } from '../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../src/rooms/Room';

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

function fakeClient(): Client & { inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { id: newId(), user: null, room: null, seq: 0, inbox, send: (m) => inbox.push(m) };
}

const gm: User = { id: 'gm1', name: 'Dana', role: 'gm', color: '#ff0000' };
const player: User = { id: 'p1', name: 'Newbie', role: 'player', color: '#00ff00' };
const policy = { autoIntervalMs: 60 * 60_000, keepAllForMs: 1e12, keepDailyForMs: 1e12 };

function say(room: Room, client: Client, text: string) {
  room.handleClientAction(client, newId(), chatActions.send.create({ id: newId(), text }));
}

test('changes are saved to the database on flush', async () => {
  const room = new Room('main', createInitialState(newId()), store, policy);
  const c = fakeClient();
  room.join(c, gm);
  say(room, c, 'hello');
  await room.flush();
  assert.equal((await store.load('main'))!.chat[0]!.text, 'hello');
});

test('first flush takes an automatic snapshot; later flushes within the interval do not', async () => {
  const room = new Room('main', createInitialState(newId()), store, policy);
  const c = fakeClient();
  room.join(c, gm);
  await room.flush();
  say(room, c, 'again');
  await room.flush();
  const snaps = await store.listSnapshots('main');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]!.reason, 'auto');
});

test('restore replaces state, keeps online users, re-welcomes everyone, and is undoable', async () => {
  const room = new Room('main', createInitialState(newId()), store, policy);
  const gmClient = fakeClient();
  room.join(gmClient, gm);
  say(room, gmClient, 'before snapshot');
  const snap = await room.createSnapshot('manual', 'checkpoint');

  // A player joins after the snapshot, then chaos happens.
  const playerClient = fakeClient();
  room.join(playerClient, player);
  say(room, gmClient, 'oops');
  assert.equal(room.currentState.chat.length, 2);

  gmClient.inbox.length = 0;
  playerClient.inbox.length = 0;
  await room.restore(snap.id, gm);

  assert.deepEqual(
    room.currentState.chat.map((m) => m.text),
    ['before snapshot'],
  );
  assert.ok(room.currentState.users[player.id], 'player who joined later is still a user');
  for (const c of [gmClient, playerClient]) {
    const welcome = c.inbox.find((m) => m.t === 'welcome');
    assert.ok(welcome && welcome.t === 'welcome' && welcome.seq === 0);
    assert.equal(welcome.state.chat.length, 1);
    assert.ok(c.inbox.some((m) => m.t === 'notice'));
  }
  // Seq restarts so the next action is #1 for each client.
  say(room, gmClient, 'after');
  const next = playerClient.inbox.find((m) => m.t === 'action');
  assert.ok(next && next.t === 'action' && next.seq === 1);

  // Undo the restore via the automatic pre-restore snapshot.
  const pre = (await store.listSnapshots('main')).find((s) => s.reason === 'pre-restore')!;
  assert.deepEqual(
    (await store.loadSnapshot('main', pre.id))!.chat.map((m) => m.text),
    ['before snapshot', 'oops'],
  );
  await room.flush();
  assert.equal((await store.load('main'))!.chat.length, 2, 'restored state (+1 new message) was persisted');
});

test('restoring a snapshot from another room fails', async () => {
  const other = new Room('other', createInitialState(newId()), store, policy);
  const snap = await other.createSnapshot('manual', null);
  const room = new Room('main', createInitialState(newId()), store, policy);
  await assert.rejects(room.restore(snap.id, gm), /not found/);
});
