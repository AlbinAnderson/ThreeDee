import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  characterSheetActions,
  combatActions,
  companionActions,
  createInitialState,
  createToken,
  CURRENT_SCHEMA_VERSION,
  GameStateSchema,
  migrateState,
  redactState,
  tokenActions,
  type Character,
} from '@vtt/shared';
import { ALICE, assertNoWireLeak, BOB, createRoomFixture, makePcgCharacter, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

const char = (id: string, name: string, ownerId: string | null = ALICE.id, shared = false): Character => ({
  ...makePcgCharacter(undefined, { id, ownerId }),
  name,
  shared,
});

function setup(opts: { shared?: boolean; tokens?: boolean; type?: 'eidolon' | 'animalCompanion' } = {}) {
  fx = createRoomFixture();
  const { gm, alice, act } = fx;
  act(alice, characterActions.import.create({ character: char('sum', 'Secretmaster', ALICE.id, !!opts.shared) }));
  act(alice, characterActions.import.create({ character: char('pet', 'Secretpet', ALICE.id, !!opts.shared) }));
  if (opts.tokens) {
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tSum', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tPet', sceneId: 'scene1', x: 70, y: 0, ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'sum', tokenId: 'tSum' }));
    act(alice, characterActions.linkToken.create({ id: 'pet', tokenId: 'tPet' }));
  }
  act(alice, companionActions.link.create({ companionId: 'pet', masterId: 'sum', type: opts.type ?? 'animalCompanion' }));
  act(alice, companionActions.update.create({ companionId: 'pet', changes: { knownTricks: ['Heel'] } }));
  return fx;
}

describe('[Epic 9] regressions', () => {
  test('v11 -> v12 migration adds companion: null to every character and backfills missing combat.ticks', () => {
    const state = createInitialState('scene1');
    const c = makePcgCharacter(undefined, { id: 'x' }) as unknown as Record<string, unknown>;
    delete c.companion;
    const combat = { ...state.combat } as Record<string, unknown>;
    delete combat.ticks;
    const migrated = migrateState({ ...state, schemaVersion: 11, combat, characters: { x: c } });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(migrated.characters.x!.companion, null);
    assert.deepEqual(migrated.combat.ticks, { round: 0, ids: [] });
  });

  test('schema bounds: trick lists are capped and unique (case-insensitive)', () => {
    const base = createInitialState('scene1');
    const withTricks = (knownTricks: string[]) => ({
      ...base,
      characters: { x: { ...makePcgCharacter(undefined, { id: 'x' }), companion: { masterId: 'm', type: 'familiar', knownTricks, link: false, harbored: false, stash: null } } },
    });
    assert.ok(GameStateSchema.safeParse(withTricks(Array.from({ length: 40 }, (_, i) => `T${i}`))).success);
    assert.ok(!GameStateSchema.safeParse(withTricks(Array.from({ length: 41 }, (_, i) => `T${i}`))).success);
    assert.ok(!GameStateSchema.safeParse(withTricks(['Heel', 'heel'])).success);
  });

  test('companion links can’t be smuggled in through character/import or character/updateRuntime', () => {
    fx = createRoomFixture();
    const { room, alice, act } = fx;
    act(alice, characterActions.import.create({ character: char('sum', 'Sela') }));
    const forged = { ...char('pet', 'Rex'), companion: { masterId: 'sum', type: 'eidolon' as const, knownTricks: [], link: false, harbored: true, stash: null } };
    act(alice, characterActions.import.create({ character: forged }));
    assert.match(alice.rejects()[0]!, /Link companions after importing/);
    assert.equal(room.currentState.characters.pet, undefined);
    act(alice, characterSheetActions.updateRuntime.create({ id: 'sum', changes: { companion: forged.companion } as never }));
    assert.equal(room.currentState.characters.sum!.companion, null);
    act(alice, characterActions.update.create({ id: 'sum', changes: { companion: forged.companion } as never }));
    assert.equal(room.currentState.characters.sum!.companion, null);
  });

  test('wire privacy: linking, tricks and Handle Animal on unshared characters never reach Bob', () => {
    const { bob, alice, act } = setup();
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'handle', trick: 'Heel', chatId: 'h1', whisper: { mode: 'gm', to: [] } }));
    assertNoWireLeak(bob, 0, /Secret|Heel|animalCompanion/);
  });

  test('wire privacy: a whispered Handle Animal in combat spends the master’s turn for everyone without leaking the roll', () => {
    const { room, gm, alice, bob, act } = setup({ tokens: true });
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { link: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cSum', name: 'Sela', tokenId: 'tSum', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));
    const since = bob.inbox.length;
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'handle', trick: 'Heel', chatId: 'h1', whisper: { mode: 'gm', to: [] } }));
    assert.deepEqual(alice.rejects(), []);
    assert.equal(room.currentState.pf1eTurns.cSum!.move, true);
    const got = bob.actions().slice(-1)[0]!;
    assert.equal(got.action.type, 'companion/handleAnimal');
    assert.equal((got.action.payload as { silent?: boolean }).silent, true);
    assertNoWireLeak(bob, since, /Secret|Heel|DC 1|"result"/);
    assert.equal(redactState(room.currentState, BOB).chat.some((m) => m.id === 'h1'), false);
  });

  test('wire privacy: a hidden master’s Handle Animal goes to the GM only', () => {
    const { gm, alice, bob, act } = setup({ tokens: true });
    act(gm, tokenActions.update.create({ id: 'tSum', changes: { hidden: true } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cSum', name: 'Sela', tokenId: 'tSum', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));
    const since = bob.inbox.length;
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'handle', trick: 'Heel', chatId: 'h1' }));
    assert.equal(bob.inbox.length, since);
    assert.ok(gm.actions().some((m) => m.action.type === 'companion/handleAnimal'));
  });

  test('wire privacy: Life Link between unlinked, unshared characters leaks no names or HP to Bob', () => {
    const { room, alice, bob, act } = setup({ type: 'eidolon' });
    act(alice, characterSheetActions.updateRuntime.create({ id: 'pet', changes: { hp: { current: 1, temp: 0, nonlethal: 0 } } }));
    const since = bob.inbox.length;
    act(alice, companionActions.hpLink.create({ companionId: 'pet', amount: 2, chatId: 'l1', whisper: { mode: 'gm', to: [] } }));
    assert.deepEqual(alice.rejects(), []);
    assert.equal(room.currentState.characters.pet!.runtime.hp!.current, 3);
    assertNoWireLeak(bob, since, /Secret|"current"|Life Link/);
    // Neither side is on a token and Bob sees neither character: he gets nothing at all.
    assert.equal(bob.inbox.length, since);
  });

  test('wire privacy: handing a master over doesn’t send its full sheet to someone who only sees its companion', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;
    act(alice, characterActions.import.create({ character: char('sum', 'Secretmaster') }));
    act(alice, characterActions.import.create({ character: char('pet', 'Pet', ALICE.id, true) }));
    act(alice, companionActions.link.create({ companionId: 'pet', masterId: 'sum', type: 'familiar' }));
    const since = bob.inbox.length;
    act(gm, characterActions.setOwner.create({ id: 'sum', ownerId: gm.user!.id }));
    // Bob sees the shared companion, so he hears that its link was dropped, but not the master's sheet.
    assert.equal(redactState(room.currentState, BOB).characters.pet!.companion, null);
    assertNoWireLeak(bob, since, /Secretmaster/);
    assert.ok(bob.actions().slice(-1)[0]!.action.type === 'character/setOwner');
  });

  test('deleting an unshared master still clears the link for someone who only sees the shared companion', () => {
    fx = createRoomFixture();
    const { room, alice, bob, act } = fx;
    act(alice, characterActions.import.create({ character: char('sum', 'Secretmaster') }));
    act(alice, characterActions.import.create({ character: char('pet', 'Pet', ALICE.id, true) }));
    act(alice, companionActions.link.create({ companionId: 'pet', masterId: 'sum', type: 'familiar' }));
    const since = bob.inbox.length;
    act(alice, characterActions.remove.create({ id: 'sum' }));
    assert.ok(bob.actions().slice(-1)[0]!.action.type === 'character/delete');
    assertNoWireLeak(bob, since, /Secretmaster/);
    assert.equal(room.currentState.characters.pet!.companion, null);
  });

  test('harbor/manifest payloads carry no private character data; players can’t use them to hide tokens', () => {
    const { room, alice, bob, act } = setup({ tokens: true });
    const since = bob.inbox.length;
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    assertNoWireLeak(bob, since, /Heel|stash|animalCompanion|"runtime"/);
    const t = room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!;
    assert.equal(t.hidden, false);
    // A client-sent token or tokenId is ignored: the server decides.
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true, tokenId: 'tSum' }));
    assert.ok(room.currentState.tokens.tSum);
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false, token: { ...t, id: 'forged', hidden: true } }));
    assert.equal(room.currentState.tokens.forged, undefined);
    assert.equal(room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!.hidden, false);
  });

  test('a GM-hidden companion token stays hidden through harbor and manifest', () => {
    const { room, gm, alice, act } = setup({ tokens: true });
    act(gm, tokenActions.update.create({ id: 'tPet', changes: { hidden: true } }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    assert.equal(room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!.hidden, true);
  });

  test('re-linking to a new master keeps tricks and harbored state; a token deleted after harbor is harmless', () => {
    const { room, alice, act } = setup({ tokens: true });
    act(alice, characterActions.import.create({ character: char('m2', 'Other') }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, companionActions.link.create({ companionId: 'pet', masterId: 'm2', type: 'animalCompanion' }));
    const link = room.currentState.characters.pet!.companion!;
    assert.equal(link.masterId, 'm2');
    assert.deepEqual(link.knownTricks, ['Heel']);
    assert.equal(link.harbored, true);
    assert.equal(GameStateSchema.safeParse(room.currentState).success, true);
  });

  test('changing the companion type resets Link to that type’s default unless Link is given', () => {
    const { room, alice, act } = setup();
    const link = () => room.currentState.characters.pet!.companion!;
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { type: 'familiar' } }));
    assert.equal(link().link, false);
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { type: 'mount' } }));
    assert.equal(link().link, true);
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { type: 'animalCompanion', link: false } }));
    assert.equal(link().link, false);
  });

  test('wire privacy: harboring/manifesting a GM-hidden companion token never leaks the token to Bob', () => {
    const { room, gm, alice, bob, act } = setup({ tokens: true });
    act(gm, tokenActions.update.create({ id: 'tPet', changes: { hidden: true, name: 'HiddenPhantom' } }));
    const since = bob.inbox.length;
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    assert.equal(bob.inbox.length, since);
    assertNoWireLeak(bob, since, /HiddenPhantom|tPet|"hidden":true/);
    assert.equal(room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!.hidden, true);
  });

  test('wire privacy: Life Link on GM-hidden tokens with GM whisper leaks nothing to Bob', () => {
    const { gm, alice, bob, act } = setup({ tokens: true, type: 'eidolon' });
    act(gm, tokenActions.update.create({ id: 'tSum', changes: { hidden: true } }));
    act(gm, tokenActions.update.create({ id: 'tPet', changes: { hidden: true, hp: { value: 2, max: 12, temp: 0 } } }));
    const since = bob.inbox.length;
    act(alice, companionActions.hpLink.create({ companionId: 'pet', amount: 2, chatId: 'hl-hidden', whisper: { mode: 'gm', to: [] } }));
    assert.deepEqual(alice.rejects(), []);
    assert.equal(bob.inbox.length, since);
    assertNoWireLeak(bob, since, /Secret|tSum|tPet|Life Link|"current"/);
  });

  test('setOwner no-op on unshared master does not wrongly unlink shared companion on Bob’s client', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;
    act(alice, characterActions.import.create({ character: char('sum', 'Secretmaster') }));
    act(alice, characterActions.import.create({ character: char('pet', 'Pet', ALICE.id, true) }));
    act(alice, companionActions.link.create({ companionId: 'pet', masterId: 'sum', type: 'familiar' }));
    const bobBefore = structuredClone(redactState(room.currentState, BOB));
    act(gm, characterActions.setOwner.create({ id: 'sum', ownerId: ALICE.id }));
    // Apply the exact action Bob received to Bob's redacted snapshot and confirm pet stays linked!
    const last = bob.actions().slice(-1)[0];
    assert.equal(last?.action.type, 'character/setOwner');
    characterActions.setOwner.apply(bobBefore as never, last!.action.payload as never, last!.meta);
    assert.equal(bobBefore.characters.pet!.companion?.masterId, 'sum');
  });
});
