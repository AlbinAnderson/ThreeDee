import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  CLASS_ACTIONS,
  characterActions,
  characterResources,
  combatActions,
  createCharacterFromPcg,
  createInitialState,
  createToken,
  CURRENT_SCHEMA_VERSION,
  GENERIC_ACTIONS,
  migrateState,
  newId,
  parsePcg,
  pf1eTurnActions,
  redactState,
  tokenActions,
  type GameAction,
  type ServerMessage,
  type User,
} from '@vtt/shared';
import { SqliteRoomStore } from '../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../src/rooms/Room';

const SAMPLE = fs.readFileSync(new URL('./fixtures/sample-pf1e.pcg', import.meta.url), 'utf8');
const SAMURAI = SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Samurai|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Samurai=1');
const INVESTIGATOR = SAMPLE.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Investigator|LEVEL:2')
  .replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Investigator=2')
  .replace('STAT:INT|SCORE:10', 'STAT:INT|SCORE:14');

let dir: string;
let store: SqliteRoomStore;
const openRooms: Room[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-test-'));
  store = new SqliteRoomStore(path.join(dir, 'vtt.db'));
});
afterEach(async () => {
  for (const r of openRooms.splice(0)) await r.flush({ autoSnapshot: false });
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const gmUser: User = { id: 'gm1', name: 'Dana', role: 'gm', color: '#ff0000' };
const alice: User = { id: 'alice', name: 'Alice', role: 'player', color: '#00ff00' };
const bob: User = { id: 'bob', name: 'Bob', role: 'player', color: '#0000ff' };

type TestClient = Client & { inbox: ServerMessage[]; rejects(): string[] };
function client(): TestClient {
  const inbox: ServerMessage[] = [];
  return { id: newId(), user: null, room: null, seq: 0, inbox, send: (m) => inbox.push(m), rejects: () => inbox.flatMap((m) => (m.t === 'reject' ? [m.reason] : [])) };
}

/** Alice's character on token "hero" (init 20) vs a goblin (init 10), combat started on the hero's turn. */
function setup(pcg = SAMPLE) {
  const room = new Room('main', createInitialState('scene1'), store, { autoIntervalMs: 1e12, keepAllForMs: 1e12, keepDailyForMs: 1e12 });
  openRooms.push(room);
  const g = client();
  const a = client();
  room.join(g, gmUser);
  room.join(a, alice);
  const act = (c: Client, action: GameAction) => room.handleClientAction(c, newId(), action);
  const ch = createCharacterFromPcg(parsePcg(pcg), { id: 'char', ownerId: 'alice', fileName: 'v.pcg', importedBy: 'alice', now: 1 });
  act(a, characterActions.import.create({ character: ch }));
  act(g, tokenActions.create.create({ token: createToken({ id: 'hero', sceneId: 'scene1', x: 0, y: 0, ownerIds: ['alice'] }) }));
  act(g, tokenActions.create.create({ token: createToken({ id: 'gob', sceneId: 'scene1', x: 70, y: 0 }) }));
  act(a, characterActions.linkToken.create({ id: 'char', tokenId: 'hero' }));
  act(g, combatActions.add.create({ combatant: { id: 'cHero', name: 'Hero', tokenId: 'hero', initiative: 20, modifier: 0, hidden: false } }));
  act(g, combatActions.add.create({ combatant: { id: 'cGob', name: 'Goblin', tokenId: 'gob', initiative: 10, modifier: 0, hidden: false } }));
  act(g, combatActions.start.create({}));
  const doAct = (c: TestClient, actionId: string, combatantId = 'cHero') =>
    act(c, pf1eTurnActions.act.create({ actionId, combatantId, chatId: newId() }));
  return { room, g, a, act, doAct };
}

describe('PF1e action economy', () => {
  test('standard + move, then nothing else; a new round gives a fresh turn', () => {
    const { room, g, a, act, doAct } = setup();
    doAct(a, 'g.attack');
    doAct(a, 'g.attack');
    assert.ok(a.rejects().includes('Standard action already used'));
    doAct(a, 'g.move');
    doAct(a, 'g.move');
    assert.ok(a.rejects().includes('No move action left'));
    doAct(a, 'g.fivefoot');
    assert.ok(a.rejects().includes('Not after moving this turn'));
    doAct(a, 'g.fullattack');
    assert.ok(a.rejects().includes('You already took a full-round action') || a.rejects().includes('A full-round action needs your whole turn'));
    assert.equal(room.currentState.chat.filter((m) => m.card?.title.includes('Valeros')).length, 2, 'accepted actions are announced in chat');

    act(g, combatActions.next.create({})); // goblin
    doAct(a, 'g.attack');
    assert.ok(a.rejects().includes('Only on your turn'));
    act(g, combatActions.next.create({})); // round 2, hero again
    const before = a.rejects().length;
    doAct(a, 'g.fullattack');
    assert.equal(a.rejects().length, before, 'fresh turn allows a full-round action');
  });

  test('two moves (standard traded for a move) block a standard; 5-foot step blocks movement', () => {
    const { a, doAct } = setup();
    doAct(a, 'g.fivefoot');
    doAct(a, 'g.move');
    assert.ok(a.rejects().includes('You already took a 5-foot step this turn'));
    doAct(a, 'g.draw');
    doAct(a, 'g.standup');
    doAct(a, 'g.attack');
    assert.deepEqual(a.rejects().slice(-1), ['Standard action already used']);
  });

  test('attacks of opportunity: one per round, not while flat-footed', () => {
    const { g, a, act, doAct } = setup();
    doAct(g, 'g.aoo', 'cGob');
    assert.ok(g.rejects().some((r) => r.includes('Flat-footed')), 'goblin has not acted yet in round 1');
    act(g, combatActions.next.create({})); // goblin acts -> no longer flat-footed
    doAct(a, 'g.aoo');
    doAct(a, 'g.aoo');
    assert.ok(a.rejects().some((r) => r.startsWith('No attacks of opportunity left')));
  });

  test('an off-turn immediate action uses up the next turn’s swift action', () => {
    const { a, g, act, doAct } = setup(SAMURAI);
    act(g, combatActions.next.create({})); // goblin's turn; hero acted in round 1 so not flat-footed
    doAct(a, 'c.samurai.resolute');
    assert.equal(a.rejects().length, 0, a.rejects().join(';'));
    act(g, combatActions.next.create({})); // hero, round 2
    doAct(a, 'c.samurai.challenge');
    assert.ok(a.rejects().some((r) => r.startsWith('Swift action already used')));
    doAct(a, 'g.attack');
    doAct(a, 'c.samurai.challenge');
    assert.ok(a.rejects().filter((r) => r.startsWith('Swift action already used')).length === 2, 'still locked after other actions');
  });
});

describe('PF1e class actions & resources', () => {
  test('class actions need the class; resources count down and reset', () => {
    const { room, a, doAct, act } = setup();
    doAct(a, 'c.barbarian.rage');
    assert.ok(a.rejects().some((r) => r.includes('doesn’t have the Barbarian class')));

    const school = () => characterResources(room.currentState.characters.char!).find((r) => r.def.id === 'school')!;
    assert.equal(school().max, 3, 'Wizard school power: 3 + Int (0)');
    doAct(a, 'c.wizard.school');
    assert.equal(school().used, 1);
    act(a, pf1eTurnActions.resetUses.create({ characterId: 'char' }));
    assert.equal(school().used, 0);
  });

  test('samurai resolve is 1/day at level 1', () => {
    const { room, a, g, act, doAct } = setup(SAMURAI);
    act(g, combatActions.next.create({}));
    doAct(a, 'c.samurai.resolute');
    act(g, combatActions.next.create({}));
    doAct(a, 'c.samurai.determined');
    assert.ok(a.rejects().some((r) => r.startsWith('No Resolve left')));
    assert.equal(characterResources(room.currentState.characters.char!).find((r) => r.def.id === 'resolve')!.used, 1);
  });

  test('outside combat, actions are announced without spending turn actions', () => {
    const { room, a, g, act } = setup();
    act(g, combatActions.end.create({ clear: true }));
    act(a, pf1eTurnActions.act.create({ actionId: 'g.attack', characterId: 'char', chatId: newId() }));
    act(a, pf1eTurnActions.act.create({ actionId: 'g.attack', characterId: 'char', chatId: newId() }));
    assert.equal(a.rejects().length, 0);
    assert.equal(room.currentState.chat.at(-1)!.card!.subtitle, 'Standard · ranged provokes');
  });

  test('every action id is unique and every class resource has a non-negative level-1 max', () => {
    const ids = [...GENERIC_ACTIONS, ...CLASS_ACTIONS.flatMap((s) => s.actions)].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const set of CLASS_ACTIONS) {
      for (const action of set.actions) if (action.resource) assert.ok(set.resources.some((r) => r.id === action.resource), action.id);
      for (const r of set.resources) assert.ok(r.max({ level: 1, mod: () => 0 }) >= 0, `${set.className} ${r.name}`);
    }
  });

  test('ending and restarting combat clears stale pf1eTurns; removing a combatant drops its turn state', () => {
    const { room, g, a, act, doAct } = setup();
    doAct(a, 'g.attack');
    doAct(a, 'g.move');
    assert.ok(room.currentState.pf1eTurns.cHero);

    act(g, combatActions.end.create({ clear: false }));
    assert.deepEqual(room.currentState.pf1eTurns, {});
    act(g, combatActions.start.create({}));
    const before = a.rejects().length;
    doAct(a, 'g.attack');
    assert.equal(a.rejects().length, before, 'fresh encounter starts with a fresh turn');

    act(g, combatActions.remove.create({ id: 'cHero' }));
    assert.equal(room.currentState.pf1eTurns.cHero, undefined);
  });

  test('cannot pair own combatantId with another characterId to burn their resources', () => {
    const { room, g, a, act } = setup();
    const npc = createCharacterFromPcg(parsePcg(SAMPLE), { id: 'npcWiz', ownerId: null, fileName: 'npc.pcg', importedBy: 'gm1', now: 1 });
    act(g, characterActions.import.create({ character: npc }));

    act(a, pf1eTurnActions.act.create({ actionId: 'c.wizard.school', combatantId: 'cHero', characterId: 'npcWiz', chatId: newId() }));
    assert.ok(a.rejects().some((r) => r.includes('not linked') || r.includes("don't control")));
    assert.deepEqual(room.currentState.characters.npcWiz!.runtime.uses, {});
  });

  test('hidden combatant actions stay GM-only; unshared character actions send prepared who to other players', () => {
    const { room, g, a, act } = setup();
    const b = client();
    room.join(b, bob);
    act(g, combatActions.update.create({ id: 'cGob', changes: { hidden: true } }));
    act(g, combatActions.next.create({})); // goblin's turn
    const bBefore = b.inbox.length;
    act(g, pf1eTurnActions.act.create({ actionId: 'g.attack', combatantId: 'cGob', chatId: newId() }));
    assert.equal(b.inbox.slice(bBefore).filter((m) => m.t === 'action' && m.action.type === 'pf1e/act').length, 0, 'hidden action not sent to player');
    const redacted = redactState(room.currentState, bob);
    assert.equal(redacted.pf1eTurns.cGob, undefined, 'hidden combatant turn redacted');
    assert.ok(!redacted.chat.some((m) => m.card?.title.includes('Goblin')), 'hidden combatant card redacted');

    act(g, combatActions.end.create({ clear: true }));
    const bOutBefore = b.inbox.length;
    act(a, pf1eTurnActions.act.create({ actionId: 'g.attack', characterId: 'char', chatId: newId() }));
    const delivered = b.inbox.slice(bOutBefore).find((m) => m.t === 'action' && m.action.type === 'pf1e/act');
    assert.ok(delivered && delivered.t === 'action');
    assert.equal((delivered.action.payload as { who?: string }).who, room.currentState.characters.char!.name);
  });

  test('Investigator 2-point Inspiration actions spend 2 points and reject when only 1 remains', () => {
    const { room, a, doAct } = setup(INVESTIGATOR);
    // Investigator 2 with Int 14 (+2) => floor(2/2) + 2 = 3 points
    const insp = () => characterResources(room.currentState.characters.char!).find((r) => r.def.id === 'inspiration')!;
    assert.equal(insp().max, 3);
    doAct(a, 'c.investigator.inspireattack');
    assert.equal(a.rejects().length, 0);
    assert.equal(insp().used, 2);
    doAct(a, 'c.investigator.inspireattack');
    assert.ok(a.rejects().some((r) => r.includes('needs 2')), 'rejects 2-point action with 1 point left');
    assert.equal(insp().used, 2);
  });

  test('v5 -> v6 migration adds empty pf1eTurns', () => {
    const v6 = createInitialState('s1');
    const v5: Record<string, unknown> = { ...v6, schemaVersion: 5 };
    delete v5.pf1eTurns;
    const migrated = migrateState(v5);
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.pf1eTurns, {});
  });
});
