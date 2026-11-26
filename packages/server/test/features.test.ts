import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  chatActions,
  combatActions,
  createInitialState,
  createToken,
  deckActions,
  handoutActions,
  newId,
  tableActions,
  templateCells,
  tokenActions,
  visibilityPolygon,
  wallActions,
  type GameAction,
  type GameState,
  type ServerMessage,
  type Template,
  type User,
} from '@vtt/shared';
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

const policy = { autoIntervalMs: 1e12, keepAllForMs: 1e12, keepDailyForMs: 1e12 };
const gmUser: User = { id: 'gm1', name: 'Dana', role: 'gm', color: '#ff0000' };
const alice: User = { id: 'alice', name: 'Alice', role: 'player', color: '#00ff00' };
const bob: User = { id: 'bob', name: 'Bob', role: 'player', color: '#0000ff' };

type TestClient = Client & { inbox: ServerMessage[]; rejects(): string[]; json(): string };

function client(): TestClient {
  const inbox: ServerMessage[] = [];
  return {
    id: newId(),
    user: null,
    room: null,
    seq: 0,
    inbox,
    send: (m) => inbox.push(m),
    rejects: () => inbox.flatMap((m) => (m.t === 'reject' ? [m.reason] : [])),
    json: () => JSON.stringify(inbox),
  };
}

function setup() {
  const state: GameState = createInitialState('scene1');
  const room = new Room('main', state, store, policy);
  const [g, a, b] = [client(), client(), client()];
  room.join(g, gmUser);
  room.join(a, alice);
  room.join(b, bob);
  const act = (c: Client, action: GameAction) => room.handleClientAction(c, newId(), action);
  return { room, g, a, b, act };
}

describe('chat visibility', () => {
  test('whispers and GM rolls only reach the people allowed to read them', () => {
    const { room, g, a, b, act } = setup();
    act(a, chatActions.send.create({ id: newId(), text: 'psst bob', whisper: { mode: 'whisper', to: ['bob'] } }));
    act(a, chatActions.roll.create({ id: newId(), expression: '1d20', label: 'secret stealth', whisper: { mode: 'gm', to: [] } }));
    assert.ok(b.json().includes('psst bob'));
    assert.ok(!g.json().includes('psst bob'), 'GM does not get player-to-player whispers');
    assert.ok(g.json().includes('secret stealth'));
    assert.ok(!b.json().includes('secret stealth'), 'other players do not get GM-only rolls');
    assert.ok(a.json().includes('psst bob') && a.json().includes('secret stealth'), 'author sees both');

    // Late joiners get a redacted snapshot.
    const late = client();
    room.join(late, { ...bob, id: 'carol', name: 'Carol' });
    assert.ok(!late.json().includes('psst bob') && !late.json().includes('secret stealth'));
  });
});

describe('turn tracker', () => {
  test('players roll their own initiative, combat cycles rounds, only the active player can end their turn', () => {
    const { room, g, a, b, act } = setup();
    act(g, tokenActions.create.create({ token: createToken({ id: 'ta', sceneId: 'scene1', x: 0, y: 0, name: 'Valeros', ownerIds: ['alice'] }) }));
    act(g, tokenActions.create.create({ token: createToken({ id: 'tg', sceneId: 'scene1', x: 70, y: 0, name: 'Goblin' }) }));
    act(a, combatActions.add.create({ combatant: { id: 'ca', name: 'Valeros', tokenId: 'ta', initiative: null, modifier: 2, hidden: false } }));
    act(b, combatActions.add.create({ combatant: { id: 'cb', name: 'Goblin', tokenId: 'tg', initiative: 5, modifier: 0, hidden: false } }));
    assert.equal(b.rejects().length, 1, 'players cannot add tokens they do not control');
    act(g, combatActions.add.create({ combatant: { id: 'cg', name: 'Goblin', tokenId: 'tg', initiative: 30, modifier: 0, hidden: false } }));

    act(a, combatActions.rollInitiative.create({ ids: ['ca'] }));
    const init = room.currentState.combat.combatants.find((c) => c.id === 'ca')!.initiative!;
    assert.ok(init >= 3 && init <= 22);
    assert.equal(room.currentState.chat.at(-1)!.text, 'Valeros: initiative');

    act(g, combatActions.start.create({}));
    assert.equal(room.currentState.combat.currentId, 'cg', 'highest initiative goes first');
    act(a, combatActions.next.create({}));
    assert.ok(a.rejects().includes("It's not your turn"));
    act(g, combatActions.next.create({}));
    assert.equal(room.currentState.combat.currentId, 'ca');
    act(a, combatActions.next.create({}));
    assert.equal(room.currentState.combat.currentId, 'cg');
    assert.equal(room.currentState.combat.round, 2);
  });
});

describe('walls', () => {
  test('players cannot move through walls or closed doors, can open unlocked doors, GM is unrestricted', () => {
    const { room, g, a, act } = setup();
    act(g, tokenActions.create.create({ token: createToken({ id: 't', sceneId: 'scene1', x: 0, y: 0, ownerIds: ['alice'] }) }));
    // Vertical wall at x=140 and a door at x=280.
    act(g, wallActions.add.create({ walls: [{ id: 'w1', sceneId: 'scene1', points: [140, -1000, 140, 1000], door: 'closed' }] }));
    act(a, tokenActions.move.create({ id: 't', x: 210, y: 0 }));
    assert.ok(a.rejects().includes('Blocked by a wall'));
    act(a, wallActions.setDoor.create({ id: 'w1', door: 'open' }));
    act(a, tokenActions.move.create({ id: 't', x: 210, y: 0 }));
    assert.equal(room.currentState.tokens.t!.x, 210);

    act(g, wallActions.setDoor.create({ id: 'w1', door: 'locked' }));
    act(a, wallActions.setDoor.create({ id: 'w1', door: 'open' }));
    assert.ok(a.rejects().includes('The door is locked'));
    act(g, tokenActions.move.create({ id: 't', x: 0, y: 0 }));
    assert.equal(room.currentState.tokens.t!.x, 0, 'GM ignores walls');
  });

  test('visibility polygon stops at walls', () => {
    const poly = visibilityPolygon({ x: 0, y: 0 }, [[10, -50, 10, 50]], { minX: -100, minY: -100, maxX: 100, maxY: 100 });
    assert.ok(poly.length > 4);
    assert.ok(poly.every((p) => p.x <= 10 + 1e-6 || Math.abs(p.y) > 50 - 1e-6), 'nothing seen behind the wall within its span');
    assert.ok(poly.some((p) => p.x < -99), 'open side reaches the bounds');
  });
});

describe('handouts', () => {
  test('unshared handouts never reach players; sharing delivers them; unsharing removes them', () => {
    const { room, g, a, b, act } = setup();
    act(g, handoutActions.create.create({ handout: { id: 'h', title: 'Secret map', imageUrl: null, text: 'X marks it', share: 'gm', sharedWith: [], createdAt: 1 } }));
    assert.ok(!a.json().includes('Secret map'));
    act(g, handoutActions.update.create({ id: 'h', changes: { share: 'some', sharedWith: ['alice'] } }));
    assert.ok(a.json().includes('X marks it'), 'newly shared player receives the full handout');
    assert.ok(!b.json().includes('X marks it'));
    act(g, handoutActions.update.create({ id: 'h', changes: { share: 'gm' } }));
    const last = a.inbox.at(-1);
    assert.ok(last?.t === 'action' && last.action.type === 'handout/update', 'the un-share reaches alice so her client can drop it');
    const late = client();
    room.join(late, { ...alice });
    assert.ok(!late.json().includes('X marks it'));
  });
});

describe('tables and decks', () => {
  test('GM-only tables stay hidden; rolls pick a weighted entry server-side', () => {
    const { room, g, a, act } = setup();
    act(g, tableActions.create.create({ table: { id: 't1', name: 'Encounters', entries: [{ id: 'e1', text: 'Owlbear', weight: 1 }], playersCanRoll: false } }));
    assert.ok(!a.json().includes('Owlbear'));
    act(a, tableActions.roll.create({ tableId: 't1', chatId: newId() }));
    assert.ok(a.rejects().length === 1);
    act(g, tableActions.roll.create({ tableId: 't1', chatId: newId() }));
    assert.equal(room.currentState.chat.at(-1)!.card?.title, 'Owlbear');
  });

  test('shuffle order is only sent to the GM; draws take the real top card', () => {
    const { room, g, a, act } = setup();
    const ids = Array.from({ length: 20 }, (_, i) => `c${String(i).padStart(2, '0')}`);
    act(g, deckActions.create.create({
      deck: {
        id: 'd', name: 'Harrow', cards: Object.fromEntries(ids.map((id) => [id, { id, name: id, imageUrl: null, text: '' }])),
        cardOrder: ids, drawPile: [...ids], drawn: [], discard: [], playersCanDraw: true,
      },
    }));
    act(g, deckActions.shuffle.create({ deckId: 'd' }));
    assert.ok(!a.inbox.some((m) => m.t === 'action' && m.action.type === 'deck/shuffle'), 'players never receive the order');
    const top = room.currentState.decks.d!.drawPile[0]!;
    act(a, deckActions.draw.create({ deckId: 'd', faceUp: true, chatId: newId() }));
    assert.equal(room.currentState.decks.d!.drawn[0]!.cardId, top);
    assert.equal(room.currentState.decks.d!.drawPile.length, 19);
  });
});

describe('templates', () => {
  const grid = createInitialState('s').scenes.s!.grid;
  const base: Template = { id: 't', sceneId: 's', authorId: 'u', kind: 'circle', x: 700, y: 700, size: 2, angle: 0, coneAngle: 90, width: 1, color: '#ff0000' };
  test('10 ft radius burst from a grid corner covers 12 squares', () => {
    assert.equal(templateCells(base, grid).length, 12);
  });
  test('30 ft line one square wide covers 6 squares', () => {
    assert.equal(templateCells({ ...base, kind: 'line', size: 6, x: 700, y: 735 }, grid).length, 6);
  });
});
