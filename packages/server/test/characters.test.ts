import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  characterActions,
  combatActions,
  createCharacterFromPcg,
  createInitialState,
  createScene,
  createToken,
  CURRENT_SCHEMA_VERSION,
  diffCharacterBuild,
  mergeReimport,
  migrateState,
  newId,
  parsePcg,
  sceneActions,
  tokenActions,
  type Character,
  type GameAction,
  type ServerMessage,
  type User,
} from '@vtt/shared';
import { SqliteRoomStore } from '../src/persistence/SqliteRoomStore';
import { Room, type Client } from '../src/rooms/Room';

const SAMPLE = fs.readFileSync(new URL('./fixtures/sample-pf1e.pcg', import.meta.url), 'utf8');

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
  const room = new Room('main', createInitialState('scene1'), store, policy);
  openRooms.push(room);
  const [g, a, b] = [client(), client(), client()];
  room.join(g, gmUser);
  room.join(a, alice);
  room.join(b, bob);
  const act = (c: Client, action: GameAction) => room.handleClientAction(c, newId(), action);
  return { room, g, a, b, act };
}

function sampleCharacter(ownerId: string | null, importedBy: string): Character {
  return createCharacterFromPcg(parsePcg(SAMPLE), { id: newId(), ownerId, fileName: 'valeros.pcg', importedBy, now: 1 });
}

describe('characters: import & privacy', () => {
  test('a player imports their own character; only they and the GM receive it until shared', () => {
    const { room, g, a, b, act } = setup();
    const c = sampleCharacter('alice', 'alice');
    act(a, characterActions.import.create({ character: c }));
    assert.ok(room.currentState.characters[c.id]);
    assert.equal(room.currentState.characters[c.id]!.name, 'Valeros & Friends');
    assert.ok(g.json().includes('Valeros & Friends'), 'GM receives it');
    assert.ok(!b.json().includes('Valeros & Friends'), 'other players do not');

    act(a, characterActions.update.create({ id: c.id, changes: { shared: true } }));
    assert.ok(b.json().includes('Valeros & Friends'), 'sharing delivers the full character to the party');

    const late = client();
    room.join(late, { ...bob, id: 'carol', name: 'Carol' });
    assert.ok(late.json().includes('Valeros & Friends'), 'late joiner sees shared characters');
    act(a, characterActions.update.create({ id: c.id, changes: { shared: false } }));
    const late2 = client();
    room.join(late2, { ...bob, id: 'dave', name: 'Dave' });
    assert.ok(!late2.json().includes('Valeros & Friends'), 'unshared characters are redacted again');
  });

  test('players cannot import characters for someone else; the GM can', () => {
    const { room, a, g, act } = setup();
    act(a, characterActions.import.create({ character: sampleCharacter('bob', 'alice') }));
    assert.ok(a.rejects().includes('Players can only import their own characters'));
    const npc = sampleCharacter(null, 'gm1');
    act(g, characterActions.import.create({ character: npc }));
    assert.equal(room.currentState.characters[npc.id]!.ownerId, null);
  });

  test('handing a character to another player moves visibility with it', () => {
    const { room, g, a, b, act } = setup();
    const c = sampleCharacter('alice', 'gm1');
    act(g, characterActions.import.create({ character: c }));
    act(a, characterActions.setOwner.create({ id: c.id, ownerId: 'bob' }));
    assert.ok(a.rejects().includes('Only the GM can change who plays a character'));
    act(g, characterActions.setOwner.create({ id: c.id, ownerId: 'bob' }));
    assert.equal(room.currentState.characters[c.id]!.ownerId, 'bob');
    assert.ok(b.json().includes('Valeros & Friends'), 'new owner receives the full character');
    const last = a.inbox.at(-1);
    assert.ok(last?.t === 'action' && last.action.type === 'character/setOwner', 'old owner is told so their client can drop it');
  });
});

describe('characters: token links', () => {
  test('linking: own tokens only for players; GM links grant the owner control; one character per token; deleting the token unlinks', () => {
    const { room, g, a, act } = setup();
    act(g, tokenActions.create.create({ token: createToken({ id: 'tok', sceneId: 'scene1', x: 0, y: 0, name: 'Fighter' }) }));
    const c1 = sampleCharacter('alice', 'alice');
    const c2 = sampleCharacter('alice', 'alice');
    act(a, characterActions.import.create({ character: c1 }));
    act(a, characterActions.import.create({ character: c2 }));

    act(a, characterActions.linkToken.create({ id: c1.id, tokenId: 'tok' }));
    assert.ok(a.rejects().includes("You don't control that token"));

    act(g, characterActions.linkToken.create({ id: c1.id, tokenId: 'tok' }));
    assert.equal(room.currentState.characters[c1.id]!.tokenId, 'tok');
    assert.deepEqual(room.currentState.tokens.tok!.ownerIds, ['alice'], 'GM link gives the player the token');

    act(a, characterActions.linkToken.create({ id: c2.id, tokenId: 'tok' }));
    assert.equal(room.currentState.characters[c2.id]!.tokenId, 'tok');
    assert.equal(room.currentState.characters[c1.id]!.tokenId, null, 'a token links to one character at a time');

    act(g, tokenActions.remove.create({ id: 'tok' }));
    assert.equal(room.currentState.characters[c2.id]!.tokenId, null, 'deleting the token unlinks it');
  });

  test('deleting a scene unlinks characters attached to tokens on that scene', () => {
    const { room, g, a, act } = setup();
    act(g, sceneActions.create.create({ scene: createScene('scene2', 'Dungeon') }));
    act(g, tokenActions.create.create({ token: createToken({ id: 'tok2', sceneId: 'scene2', x: 0, y: 0, ownerIds: ['alice'] }) }));
    const c = sampleCharacter('alice', 'alice');
    act(a, characterActions.import.create({ character: c }));
    act(a, characterActions.linkToken.create({ id: c.id, tokenId: 'tok2' }));
    assert.equal(room.currentState.characters[c.id]!.tokenId, 'tok2');

    act(g, combatActions.add.create({ combatant: { id: 'cb2', name: 'Hero', tokenId: 'tok2', initiative: 12, modifier: 0, hidden: false } }));

    act(g, sceneActions.remove.create({ id: 'scene2' }));
    assert.equal(room.currentState.characters[c.id]!.tokenId, null);
    assert.equal(room.currentState.combat.combatants.length, 0, "the deleted scene's tokens also leave the turn order");
  });
});

describe('characters: re-import', () => {
  test('replaces build data but keeps id, owner, token link, sharing, custom name and runtime state', () => {
    const { room, g, a, act } = setup();
    act(g, tokenActions.create.create({ token: createToken({ id: 'tok', sceneId: 'scene1', x: 0, y: 0, ownerIds: ['alice'] }) }));
    const c = sampleCharacter('alice', 'alice');
    c.runtime = { hp: { current: 4, temp: 2, nonlethal: 1 }, uses: { 'channel-energy': 2 } };
    act(a, characterActions.import.create({ character: c }));
    act(a, characterActions.linkToken.create({ id: c.id, tokenId: 'tok' }));
    act(a, characterActions.update.create({ id: c.id, changes: { shared: true, name: 'Val' } }));

    const leveled = parsePcg(SAMPLE.replace('CLASS:Fighter|LEVEL:2', 'CLASS:Fighter|LEVEL:3'));
    const diff = diffCharacterBuild(c.build, leveled);
    assert.ok(diff.some((d) => d.section === 'Classes' && d.text === 'Fighter 2 → Fighter 3'), JSON.stringify(diff));

    act(a, characterActions.reimport.create({ id: c.id, build: leveled, fileName: 'valeros-lvl3.pcg' }));
    const after = room.currentState.characters[c.id]!;
    assert.equal(after.build.classes.find((k) => k.name === 'Fighter')!.level, 3);
    assert.deepEqual(after.runtime, c.runtime, 'runtime state preserved');
    assert.equal(after.tokenId, 'tok');
    assert.equal(after.ownerId, 'alice');
    assert.equal(after.shared, true);
    assert.equal(after.name, 'Val', 'name customized in the VTT is kept');
    assert.equal(after.source.fileName, 'valeros-lvl3.pcg');

    // Broadcasted reimport action should not carry a duplicate `full` copy of `build`.
    const broadcast = a.inbox.at(-1);
    assert.ok(broadcast?.t === 'action' && broadcast.action.type === 'character/reimport');
    assert.equal('full' in (broadcast.action.payload as Record<string, unknown>), false);
  });

  test('stamps server-authoritative importedBy on import and preserves custom VTT name on unnamed .pcg re-import', () => {
    const { room, a, act } = setup();
    const unnamedBuild = parsePcg('PCGVERSION:2.0\nSTAT:STR|SCORE:14\n');
    const c = createCharacterFromPcg(unnamedBuild, { id: newId(), ownerId: 'alice', fileName: 'hero.pcg', importedBy: 'gm1', now: 1 });
    act(a, characterActions.import.create({ character: c }));
    assert.equal(room.currentState.characters[c.id]!.source.importedBy, 'alice');

    const renamed: Character = { ...room.currentState.characters[c.id]!, name: 'My Custom Name' };
    const namedBuild = parsePcg('PCGVERSION:2.0\nCHARACTERNAME:Valeros\nSTAT:STR|SCORE:14\n');
    const merged = mergeReimport(renamed, namedBuild, { fileName: 'hero2.pcg', importedBy: 'alice', now: 2 });
    assert.equal(merged.name, 'My Custom Name');
  });

  test('diffCharacterBuild detects spell times, metamagic, legacyFeats, and zero quantities', () => {
    const base = parsePcg(SAMPLE);
    const updated = parsePcg(
      SAMPLE.replace('TIMES:2|CLASS:Wizard', 'TIMES:3|CLASS:Wizard')
        .replace('QUANTITY:5.0', 'QUANTITY:0.0')
        .replace('FEAT:Legacy Toughness', 'FEAT:Legacy Toughness\nFEAT:Improved Initiative'),
    );
    const diff = diffCharacterBuild(base, updated);
    assert.ok(diff.some((d) => d.section === 'Spells' && d.text.includes('×2') && d.text.includes('×3')), JSON.stringify(diff));
    assert.ok(diff.some((d) => d.section === 'Equipment' && d.text.includes('×0')), JSON.stringify(diff));
    assert.ok(diff.some((d) => d.section === 'Feats & abilities' && d.text.includes('Improved Initiative')), JSON.stringify(diff));
  });

  test('only the owner or GM can re-import', () => {
    const { b, a, act } = setup();
    const c = sampleCharacter('alice', 'alice');
    act(a, characterActions.import.create({ character: c }));
    act(a, characterActions.update.create({ id: c.id, changes: { shared: true } }));
    act(b, characterActions.reimport.create({ id: c.id, build: c.build, fileName: 'x.pcg' }));
    assert.ok(b.rejects().includes("You don't control that character"));
  });
});

describe('characters: migration', () => {
  test('v3 rooms gain an empty characters collection', () => {
    const v4 = createInitialState('s');
    const { characters: _c, ...rest } = v4;
    const s = migrateState({ ...rest, schemaVersion: 3 });
    assert.equal(s.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(s.characters, {});
  });
});
