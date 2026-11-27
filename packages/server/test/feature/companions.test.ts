import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  combatActions,
  companionActions,
  companionsOf,
  computeCharacterStats,
  createScene,
  createToken,
  hpView,
  redactState,
  sceneActions,
  tokenActions,
  type Character,
  type CompanionType,
} from '@vtt/shared';
import { ALICE, BOB, createRoomFixture, makePcgCharacter, type RoomFixture } from '../helpers/harness';

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

/**
 * Alice plays "sum" (Summoner) with a companion "pet" of `type`. Both have
 * tokens she owns ("tSum" at 140,140 and "tPet"), linked unless `tokens: false`.
 */
function setup(opts: { type?: CompanionType; tokens?: boolean; shared?: boolean } = {}) {
  fx = createRoomFixture();
  const { gm, alice, act } = fx;
  act(alice, characterActions.import.create({ character: char('sum', 'Sela', ALICE.id, !!opts.shared) }));
  act(alice, characterActions.import.create({ character: char('pet', 'Rex', ALICE.id, !!opts.shared) }));
  if (opts.tokens !== false) {
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tSum', sceneId: 'scene1', x: 140, y: 140, name: 'Sela', ownerIds: [ALICE.id] }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tPet', sceneId: 'scene1', x: 700, y: 700, name: 'Rex', color: '#123456', ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'sum', tokenId: 'tSum' }));
    act(alice, characterActions.linkToken.create({ id: 'pet', tokenId: 'tPet' }));
  }
  act(alice, companionActions.link.create({ companionId: 'pet', masterId: 'sum', type: opts.type ?? 'animalCompanion' }));
  return fx;
}

describe('[Epic 9] companion links', () => {
  test('link, show on the master, change type/tricks, unlink', () => {
    const { room, alice, act } = setup({ tokens: false });
    const pet = () => room.currentState.characters.pet!;
    assert.deepEqual(alice.rejects(), []);
    assert.equal(pet().companion!.masterId, 'sum');
    assert.equal(pet().companion!.link, true);
    assert.deepEqual(companionsOf(room.currentState, 'sum').map((c) => c.id), ['pet']);
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { knownTricks: ['heel', 'Attack', 'HEEL', 'Break Out'] } }));
    assert.deepEqual(pet().companion!.knownTricks, ['Heel', 'Attack', 'Break Out']);
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { type: 'familiar', link: false } }));
    assert.equal(pet().companion!.type, 'familiar');
    assert.equal(pet().companion!.link, false);
    act(alice, companionActions.unlink.create({ companionId: 'pet' }));
    assert.equal(pet().companion, null);
  });

  test('server-side checks: ownership on both sides, same owner, no self-link or cycles', () => {
    const { room, gm, alice, bob, act } = setup({ tokens: false });
    act(bob, characterActions.import.create({ character: char('bobs', 'Bobby', BOB.id, true) }));
    act(bob, companionActions.link.create({ companionId: 'bobs', masterId: 'sum', type: 'cohort' }));
    act(bob, companionActions.update.create({ companionId: 'pet', changes: { link: false } }));
    act(bob, companionActions.unlink.create({ companionId: 'pet' }));
    assert.equal(bob.rejects().length, 3);
    act(alice, companionActions.link.create({ companionId: 'sum', masterId: 'sum', type: 'other' }));
    act(alice, companionActions.link.create({ companionId: 'sum', masterId: 'pet', type: 'other' }));
    assert.equal(alice.rejects().length, 2);
    assert.equal(room.currentState.characters.sum!.companion, null);
    // Even the GM can't cross owners: a companion belongs to its master's player.
    act(gm, companionActions.link.create({ companionId: 'bobs', masterId: 'sum', type: 'cohort' }));
    assert.match(gm.rejects()[0]!, /same player/);
    assert.equal(room.currentState.characters.bobs!.companion, null);
  });

  test('an unshared companion and its link stay private', () => {
    const { room, bob } = setup({ tokens: false });
    const bobView = redactState(room.currentState, BOB);
    assert.equal(bobView.characters.pet, undefined);
    assert.ok(!bob.json().includes('animalCompanion'));
  });
});

describe('[Epic 9] harbor and manifest', () => {
  test('harboring puts the token away (HP kept on the character); manifesting brings it back next to the master', () => {
    const { room, alice, act } = setup({ type: 'eidolon' });
    act(alice, tokenActions.update.create({ id: 'tPet', changes: { hp: { ...room.currentState.tokens.tPet!.hp!, value: 3 }, conditions: ['Shaken'], conditionRounds: { Shaken: 2 } } }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    assert.deepEqual(alice.rejects(), []);
    const pet = () => room.currentState.characters.pet!;
    assert.equal(room.currentState.tokens.tPet, undefined);
    assert.equal(pet().tokenId, null);
    assert.equal(pet().companion!.harbored, true);
    assert.equal(pet().runtime.hp!.current, 3);
    assert.deepEqual(pet().runtime.conditions, ['Shaken']);
    assert.equal(pet().companion!.stash!.color, '#123456');

    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    assert.deepEqual(alice.rejects(), []);
    const token = room.currentState.tokens[pet().tokenId!]!;
    assert.equal(token.sceneId, 'scene1');
    assert.deepEqual({ x: token.x, y: token.y }, { x: 210, y: 140 }); // right of the master's token
    assert.equal(token.hp!.value, 3);
    assert.equal(token.color, '#123456');
    assert.deepEqual(token.ownerIds, [ALICE.id]);
    assert.deepEqual(token.conditions, ['Shaken']);
    assert.deepEqual(token.conditionRounds, { Shaken: 2 });
    assert.equal(token.hidden, false);
    assert.equal(pet().companion!.harbored, false);
    assert.equal(pet().companion!.stash, null);
    // Every client has the same token.
    assert.deepEqual(redactState(room.currentState, BOB).tokens[token.id], token);
  });

  test('harboring the current combatant takes it out of the turn order cleanly', () => {
    const { room, gm, alice, act } = setup();
    act(gm, combatActions.add.create({ combatant: { id: 'cPet', name: 'Rex', tokenId: 'tPet', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cSum', name: 'Sela', tokenId: 'tSum', initiative: 10, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));
    assert.equal(room.currentState.combat.currentId, 'cPet');
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    assert.deepEqual(room.currentState.combat.combatants.map((c) => c.id), ['cSum']);
    assert.equal(room.currentState.combat.currentId, 'cSum');
  });

  test('without a master token it returns where it was; if that scene is gone, to the active scene', () => {
    const { room, gm, alice, act } = setup();
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, tokenActions.remove.create({ id: 'tSum' }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    let t = room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!;
    assert.deepEqual({ x: t.x, y: t.y }, { x: 700, y: 700 });

    act(gm, sceneActions.create.create({ scene: createScene('scene2', 'Cave') }));
    act(gm, tokenActions.create.create({ token: { ...t, id: 'tPet2', sceneId: 'scene2' } }));
    act(alice, characterActions.linkToken.create({ id: 'pet', tokenId: 'tPet2' }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(gm, sceneActions.remove.create({ id: 'scene2' }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    assert.deepEqual(alice.rejects(), []);
    t = room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!;
    assert.equal(t.sceneId, 'scene1');
  });

  test('a player can only manifest onto the active scene; the GM anywhere', () => {
    const { room, gm, alice, act } = setup();
    act(gm, sceneActions.create.create({ scene: createScene('scene2', 'Cave') }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tSum2', sceneId: 'scene2', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'sum', tokenId: 'tSum2' }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    // The master is on another scene, so Alice's companion goes back where it was (active scene).
    assert.equal(room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!.sceneId, 'scene1');
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(gm, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    assert.equal(room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!.sceneId, 'scene2');
  });

  test('a companion without any token can be harbored and manifested; it gets a token next to its master', () => {
    const { room, gm, alice, act } = setup({ tokens: false });
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    assert.equal(room.currentState.characters.pet!.tokenId, null);
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tSum', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'sum', tokenId: 'tSum' }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: false }));
    const t = room.currentState.tokens[room.currentState.characters.pet!.tokenId!]!;
    assert.equal(t.name, 'Rex');
    assert.deepEqual(t.ownerIds, [ALICE.id]);
    assert.equal(t.hp!.max, computeCharacterStats(room.currentState.characters.pet!).hp.total);
    assert.deepEqual({ x: t.x, y: t.y }, { x: 70, y: 0 });
  });

  test('while harbored: no token links, no unlinking; Bob can’t harbor Alice’s companion', () => {
    const { room, gm, alice, bob, act } = setup();
    act(bob, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    assert.equal(bob.rejects().length, 1);
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tX', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'pet', tokenId: 'tX' }));
    act(alice, companionActions.unlink.create({ companionId: 'pet' }));
    act(alice, companionActions.setHarbored.create({ companionId: 'pet', harbored: true }));
    assert.equal(alice.rejects().length, 3);
    assert.equal(room.currentState.characters.pet!.tokenId, null);
  });
});

describe('[Epic 9] companion quick actions', () => {
  test('Handle Animal: known trick required to handle; rolls to chat with DC; Link makes it free in combat', () => {
    const { room, gm, alice, act } = setup();
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'handle', trick: 'Heel', chatId: 'h0' }));
    assert.match(alice.rejects()[0]!, /doesn’t know Heel/);
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { knownTricks: ['Heel'] } }));
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'handle', trick: 'heel', chatId: 'h1' }));
    const msg = room.currentState.chat.find((m) => m.id === 'h1')!;
    assert.match(msg.text, /Sela → Rex: Handle \(Heel\) · Handle Animal vs DC 10 · free action, Link \+4 — (Success|Failure)/);
    assert.ok(msg.roll);

    act(gm, combatActions.add.create({ combatant: { id: 'cSum', name: 'Sela', tokenId: 'tSum', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));
    // Free with Link: nothing spent.
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'handle', trick: 'Heel', chatId: 'h2' }));
    assert.equal(room.currentState.pf1eTurns.cSum?.move ?? false, false);
    // Push with Link: a move action.
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'push', trick: 'Fetch', chatId: 'h3' }));
    assert.equal(room.currentState.pf1eTurns.cSum!.move, true);
    assert.match(room.currentState.chat.find((m) => m.id === 'h3')!.text, /DC 25 · move action/);
    // Without Link a push is full-round, which no longer fits.
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { link: false } }));
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'push', trick: 'Fetch', chatId: 'h4' }));
    assert.match(alice.rejects().at(-1)!, /full-round/);
    assert.equal(room.currentState.chat.some((m) => m.id === 'h4'), false);
  });

  test('Handle Animal isn’t for eidolons; the DC goes up when the animal is wounded', () => {
    const { room, alice, act } = setup();
    act(alice, tokenActions.update.create({ id: 'tPet', changes: { hp: { ...room.currentState.tokens.tPet!.hp!, value: 1 } } }));
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'push', chatId: 'h1' }));
    assert.match(room.currentState.chat.find((m) => m.id === 'h1')!.text, /DC 27 \(wounded \+2\)/);
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { type: 'eidolon' } }));
    act(alice, companionActions.handleAnimal.create({ companionId: 'pet', mode: 'push', chatId: 'h2' }));
    assert.match(alice.rejects()[0]!, /animals/);
  });

  test('Life Link moves HP from the master to the eidolon on both tokens in one action', () => {
    const { room, alice, bob, act } = setup({ type: 'eidolon' });
    const tPet = () => room.currentState.tokens.tPet!;
    const tSum = () => room.currentState.tokens.tSum!;
    const sumHp = tSum().hp!.value;
    act(alice, tokenActions.update.create({ id: 'tPet', changes: { hp: { ...tPet().hp!, value: tPet().hp!.max - 5 } } }));
    act(alice, companionActions.hpLink.create({ companionId: 'pet', amount: 6, chatId: 'l0' }));
    assert.match(alice.rejects()[0]!, /only missing 5/);
    act(alice, companionActions.hpLink.create({ companionId: 'pet', amount: 3, chatId: 'l1' }));
    assert.equal(tSum().hp!.value, sumHp - 3);
    assert.equal(tPet().hp!.value, tPet().hp!.max - 2);
    const card = room.currentState.chat.find((m) => m.id === 'l1')!.card!;
    assert.equal(card.title, 'Sela: Life Link');
    assert.equal(card.subtitle, 'Free action');
    // Bob's copy matches (token HP is public).
    const bobView = redactState(room.currentState, BOB);
    assert.equal(bobView.tokens.tPet!.hp!.value, tPet().hp!.value);
    act(bob, companionActions.hpLink.create({ companionId: 'pet', amount: 1, chatId: 'l2' }));
    assert.equal(bob.rejects().length, 1);
  });

  test('Etheric Tether between unlinked characters updates runtime HP; master can’t give more than it has', () => {
    const { room, alice, act } = setup({ type: 'phantom', tokens: false });
    const max = (id: string) => computeCharacterStats(room.currentState.characters[id]!).hp.total;
    act(alice, { type: 'character/updateRuntime', payload: { id: 'sum', changes: { hp: { current: 2, temp: 5, nonlethal: 0 } } } });
    act(alice, { type: 'character/updateRuntime', payload: { id: 'pet', changes: { hp: { current: 1, temp: 0, nonlethal: 0 } } } });
    act(alice, companionActions.hpLink.create({ companionId: 'pet', amount: 3, chatId: 'e0' }));
    assert.match(alice.rejects()[0]!, /only 2 hit points/);
    act(alice, companionActions.hpLink.create({ companionId: 'pet', amount: 2, chatId: 'e1' }));
    assert.deepEqual(room.currentState.characters.sum!.runtime.hp, { current: 0, temp: 5, nonlethal: 0 });
    assert.equal(room.currentState.characters.pet!.runtime.hp!.current, 3);
    assert.equal(hpView(room.currentState, room.currentState.characters.pet!).max, max('pet'));
    assert.equal(room.currentState.chat.find((m) => m.id === 'e1')!.card!.title, 'Sela: Etheric Tether');
    act(alice, companionActions.update.create({ companionId: 'pet', changes: { type: 'familiar' } }));
    act(alice, companionActions.hpLink.create({ companionId: 'pet', amount: 1, chatId: 'e2' }));
    assert.match(alice.rejects().at(-1)!, /eidolons/);
  });
});

describe('[Epic 9] lifecycle', () => {
  test('deleting the master drops its companions’ links; re-import keeps a companion’s link', () => {
    const { room, alice, act } = setup({ tokens: false });
    act(alice, characterActions.reimport.create({ id: 'pet', build: room.currentState.characters.pet!.build, fileName: 'rex.pcg' }));
    assert.equal(room.currentState.characters.pet!.companion!.masterId, 'sum');
    act(alice, characterActions.remove.create({ id: 'sum' }));
    assert.equal(room.currentState.characters.pet!.companion, null);
  });

  test('handing the master to another player drops the cross-owner link everywhere', () => {
    const { room, gm, alice, act } = setup({ tokens: false, shared: true });
    act(gm, characterActions.setOwner.create({ id: 'sum', ownerId: BOB.id }));
    assert.equal(room.currentState.characters.pet!.companion, null);
    assert.equal(redactState(room.currentState, ALICE).characters.pet!.companion, null);
    // Giving both to Bob and relinking works.
    act(gm, characterActions.setOwner.create({ id: 'pet', ownerId: BOB.id }));
    act(gm, companionActions.link.create({ companionId: 'pet', masterId: 'sum', type: 'familiar' }));
    assert.equal(room.currentState.characters.pet!.companion!.masterId, 'sum');
    assert.deepEqual(alice.rejects(), []);
  });
});
