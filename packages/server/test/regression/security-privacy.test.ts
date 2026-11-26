import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  characterSheetActions,
  combatActions,
  createToken,
  inventoryActions,
  lootActions,
  newId,
  pf1eTurnActions,
  redactState,
  tokenActions,
} from '@vtt/shared';
import { ALICE, BOB, createRoomFixture, makePcgCharacter, SAMPLE_PCG, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  if (fx) {
    await fx.cleanup();
    fx = null;
  }
});

describe('regression: security, authorization, privacy & payload bounds', () => {
  test('[Epics 1-4] import rejects fabricated lootId and invalid activeLoadoutId', () => {
    fx = createRoomFixture();
    const { alice, act } = fx;

    const badLoot = makePcgCharacter(SAMPLE_PCG, { id: 'c1', ownerId: ALICE.id });
    badLoot.inventory.items[0]!.lootId = 'stolen';
    act(alice, characterActions.import.create({ character: badLoot }));
    assert.ok(alice.rejects().includes('Imported items cannot reference party loot'));

    const badLoadout = makePcgCharacter(SAMPLE_PCG, { id: 'c2', ownerId: ALICE.id });
    badLoadout.inventory.activeLoadoutId = 'nope';
    act(alice, characterActions.import.create({ character: badLoadout }));
    assert.ok(alice.rejects().includes('Invalid active loadout'));
  });

  test('[Epics 1-4] linkToken prevents a shared-token co-owner from stealing another user’s linked character', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;

    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'ca', ownerId: ALICE.id }) }));
    act(bob, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'cb', ownerId: BOB.id, importedBy: BOB.id }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'shared', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id, BOB.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'ca', tokenId: 'shared' }));

    act(bob, characterActions.linkToken.create({ id: 'cb', tokenId: 'shared' }));
    assert.ok(bob.rejects().includes('That token is already linked to another character'));
    assert.equal(room.currentState.characters.ca!.tokenId, 'shared');
  });

  test('[Epic 3] pf1e/act rejects pairing own combatantId with foreign characterId and keeps hidden combatants GM-only', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;

    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'ca', ownerId: ALICE.id }) }));
    act(gm, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'npc', ownerId: null, importedBy: 'gm1' }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'ta', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tnpc', sceneId: 'scene1', x: 70, y: 0, hidden: true }) }));
    act(alice, characterActions.linkToken.create({ id: 'ca', tokenId: 'ta' }));
    act(gm, combatActions.add.create({ combatant: { id: 'cba', name: 'Hero', tokenId: 'ta', initiative: 20, modifier: 0, hidden: false } }));
    act(gm, combatActions.add.create({ combatant: { id: 'cbn', name: 'Shadow', tokenId: 'tnpc', initiative: 10, modifier: 0, hidden: false } }));
    act(gm, combatActions.start.create({}));

    act(alice, pf1eTurnActions.act.create({ actionId: 'c.wizard.school', combatantId: 'cba', characterId: 'npc', chatId: newId() }));
    assert.ok(alice.rejects().length >= 1);
    assert.deepEqual(room.currentState.characters.npc!.runtime.uses, {});

    // Hidden combatant action does not leak to players in real time or in redacted snapshots.
    act(gm, combatActions.next.create({}));
    const bBefore = bob.inbox.length;
    act(gm, pf1eTurnActions.act.create({ actionId: 'g.attack', combatantId: 'cbn', chatId: newId() }));
    assert.equal(bob.inbox.slice(bBefore).filter((m) => m.t === 'action' && m.action.type === 'pf1e/act').length, 0);
    assert.equal(redactState(room.currentState, BOB).pf1eTurns.cbn, undefined);
    assert.ok(!redactState(room.currentState, BOB).chat.some((m) => m.card?.title.includes('Shadow')));

    // Out-of-combat action for an unshared character sends server-prepared `who` so Bob doesn't see "Someone".
    act(gm, combatActions.end.create({ clear: true }));
    const bOut = bob.inbox.length;
    act(alice, pf1eTurnActions.act.create({ actionId: 'g.attack', characterId: 'ca', chatId: newId() }));
    const msg = bob.inbox.slice(bOut).find((m) => m.t === 'action' && m.action.type === 'pf1e/act');
    assert.ok(msg && msg.t === 'action' && (msg.action.payload as { who?: string }).who === 'Valeros & Friends');
  });

  test('[Epic 4] stowed loot cannot be tampered with or deleted by non-GMs; 0-qty transfers cannot duplicate items', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;

    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'ca', ownerId: ALICE.id }) }));
    act(bob, lootActions.create.create({ id: 'l1', item: { name: 'Relic', imageUrl: null, quantity: 1, value: '100 gp', holderId: null, notes: '' } }));
    act(gm, lootActions.setSecret.create({ id: 'l1', secretNotes: 'Secret curse' }));
    act(alice, inventoryActions.takeLoot.create({ lootId: 'l1', characterId: 'ca', itemId: 'iRelic', quantity: 1 }));
    assert.equal(room.currentState.loot.l1!.stowed, true);

    act(bob, lootActions.update.create({ id: 'l1', changes: { name: 'Hacked' } }));
    assert.ok(bob.rejects().includes('Item is stowed in an inventory'));
    act(bob, lootActions.remove.create({ id: 'l1' }));
    assert.ok(bob.rejects().includes('Only the GM can delete a stowed loot record'));

    // 0-quantity loot & inventory items cannot materialize free copies.
    act(gm, lootActions.create.create({ id: 'zero', item: { name: 'Zero', imageUrl: null, quantity: 0, value: '', holderId: null, notes: '' } }));
    act(alice, inventoryActions.takeLoot.create({ lootId: 'zero', characterId: 'ca', itemId: 'z1', quantity: 1 }));
    assert.ok(alice.rejects().includes('None left'));

    const rations = room.currentState.characters.ca!.inventory.items.find((i) => i.name === 'Trail Rations')!;
    act(alice, inventoryActions.adjust.create({ characterId: 'ca', itemId: rations.id, quantity: -100 }));
    act(alice, inventoryActions.giveToLoot.create({ characterId: 'ca', itemId: rations.id, quantity: 1, newLootId: 'freeRations' }));
    assert.ok(alice.rejects().includes('None in the inventory'));
    assert.equal(room.currentState.loot.freeRations, undefined);
  });

  test('[Epics 1-4] character rename, unshare, return-to-GM, updateSheet and updateRuntime omit full build payload', () => {
    fx = createRoomFixture();
    const { gm, alice, bob, act } = fx;

    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'ca', ownerId: ALICE.id }) }));
    const lastAction = (c: typeof gm) => c.actions().at(-1)!.action.payload as Record<string, unknown>;

    act(alice, characterActions.update.create({ id: 'ca', changes: { name: 'Renamed' } }));
    assert.equal(lastAction(gm).full, undefined);

    act(alice, characterActions.update.create({ id: 'ca', changes: { shared: true } }));
    assert.ok(lastAction(bob).full, 'sharing sends full to newly allowed viewers');

    act(alice, characterActions.update.create({ id: 'ca', changes: { shared: false } }));
    assert.equal(lastAction(bob).full, undefined, 'unsharing omits full');

    act(gm, characterActions.setOwner.create({ id: 'ca', ownerId: null }));
    assert.equal(lastAction(alice).full, undefined, 'returning to GM omits full');

    act(gm, characterSheetActions.updateSheet.create({ id: 'ca', changes: { misc: { ac: 1 } } }));
    assert.equal('full' in lastAction(gm), false);

    act(gm, characterSheetActions.updateRuntime.create({ id: 'ca', changes: { abilityTemp: { STR: 2 } } }));
    assert.equal('full' in lastAction(gm), false);
  });
});
