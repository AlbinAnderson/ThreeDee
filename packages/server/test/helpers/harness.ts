/**
 * Shared test harness for unit, feature and regression suites.
 * Keeps Room / SqliteRoomStore setup, client inbox inspection and fixture
 * loading uniform so tests stay concise and never leak timers or temp dirs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCharacterFromPcg,
  createInitialState,
  newId,
  parsePcg,
  type Character,
  type GameAction,
  type GameState,
  type ServerMessage,
  type User,
} from '@vtt/shared';
import { SqliteRoomStore } from '../../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../../src/rooms/Room';

export const SAMPLE_PCG = fs.readFileSync(new URL('../fixtures/sample-pf1e.pcg', import.meta.url), 'utf8');

export const GM_USER: User = { id: 'gm1', name: 'Dana', role: 'gm', color: '#ff0000' };
export const ALICE: User = { id: 'alice', name: 'Alice', role: 'player', color: '#00ff00' };
export const BOB: User = { id: 'bob', name: 'Bob', role: 'player', color: '#0000ff' };
export const CAROL: User = { id: 'carol', name: 'Carol', role: 'player', color: '#ffaa00' };

export const NO_AUTO_SNAPSHOT = { autoIntervalMs: 1e12, keepAllForMs: 1e12, keepDailyForMs: 1e12 };

export type TestClient = Client & {
  inbox: ServerMessage[];
  rejects(): string[];
  actions(): Extract<ServerMessage, { t: 'action' }>[];
  json(): string;
};

export function createTestClient(): TestClient {
  const inbox: ServerMessage[] = [];
  return {
    id: newId(),
    user: null,
    room: null,
    seq: 0,
    inbox,
    send: (m) => inbox.push(m),
    rejects: () => inbox.flatMap((m) => (m.t === 'reject' ? [m.reason] : [])),
    actions: () => inbox.filter((m): m is Extract<ServerMessage, { t: 'action' }> => m.t === 'action'),
    json: () => JSON.stringify(inbox),
  };
}

export function withPcgLines(pcg: string, ...lines: string[]): string {
  return `${pcg}\n${lines.join('\n')}\n`;
}

export function makePcgCharacter(
  pcg = SAMPLE_PCG,
  opts: Partial<{ id: string; ownerId: string | null; fileName: string; importedBy: string; now: number }> = {},
): Character {
  return createCharacterFromPcg(parsePcg(pcg), {
    id: opts.id ?? newId(),
    ownerId: opts.ownerId === undefined ? ALICE.id : opts.ownerId,
    fileName: opts.fileName ?? 'valeros.pcg',
    importedBy: opts.importedBy ?? ALICE.id,
    now: opts.now ?? 1,
  });
}

export interface RoomFixture {
  dir: string;
  store: SqliteRoomStore;
  room: Room;
  gm: TestClient;
  alice: TestClient;
  bob: TestClient;
  act(client: Client, action: GameAction): void;
  cleanup(): Promise<void>;
}

export function createRoomFixture(initial?: GameState): RoomFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-suite-'));
  const store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
  const room = new Room('main', initial ?? createInitialState('scene1'), store, NO_AUTO_SNAPSHOT);
  const gm = createTestClient();
  const alice = createTestClient();
  const bob = createTestClient();
  room.join(gm, GM_USER);
  room.join(alice, ALICE);
  room.join(bob, BOB);
  const act = (c: Client, action: GameAction) => room.handleClientAction(c, newId(), action);
  const cleanup = async () => {
    await room.flush({ autoSnapshot: false });
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, store, room, gm, alice, bob, act, cleanup };
}

/**
 * The sample character rebuilt as a spellcaster (Epic 7): its classes and
 * spell lines are replaced. Spell lines use real PCGen 6 syntax, e.g.
 * `SPELLNAME:Fireball|TIMES:1|CLASS:Wizard|BOOK:Known Spells|SPELLLEVEL:3`.
 */
export function casterPcg(opts: {
  classes: string[];
  spells?: string[];
  stats?: Partial<Record<'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA', number>>;
  align?: string;
  extra?: string[];
}): string {
  const lines = SAMPLE_PCG.split('\n')
    .filter((l) => !/^(CLASS:|CLASSABILITIESLEVEL:|SPELLBOOK:|SPELLLIST:|SPELLNAME:|SPELLMEM:)/.test(l))
    .map((l) => {
      const stat = /^STAT:([A-Z]{3})\|SCORE:\d+/.exec(l);
      if (stat && opts.stats?.[stat[1] as 'STR']) return `STAT:${stat[1]}|SCORE:${opts.stats[stat[1] as 'STR']}`;
      if (opts.align && l.startsWith('ALIGN:')) return `ALIGN:${opts.align}`;
      return l;
    });
  return [...lines, ...opts.classes, ...(opts.spells ?? []), ...(opts.extra ?? [])].join('\n') + '\n';
}

/** A PCGen 6 spell line. */
export const spellLine = (name: string, cls: string, level: number, book = 'Known Spells', times = 1, extra = '') =>
  `SPELLNAME:${name}|TIMES:${times}|CLASS:${cls}|BOOK:${book}|SPELLLEVEL:${level}${extra}|SOURCE:[TYPE:CLASS|NAME:${cls}]`;
