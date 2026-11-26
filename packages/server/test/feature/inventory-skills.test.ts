import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  characterResources,
  characterSheetActions,
  computeCharacterStats,
  computeSkills,
  createToken,
  inventoryActions,
  lootActions,
  makeItem,
  newId,
  pf1eTurnActions,
  redactState,
  tokenActions,
} from '@vtt/shared';
import { ALICE, createRoomFixture, makePcgCharacter, SAMPLE_PCG, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  if (fx) {
    await fx.cleanup();
    fx = null;
  }
});

describe('feature: inventory, loadouts, light sync, party loot & skills', () => {
  test('rings cap at 2, loadouts switch AC & encumbrance, lit torch syncs to token, and loot identify flow works end-to-end', () => {
    fx = createRoomFixture();
    const { room, gm, alice, bob, act } = fx;

    const invPcg = SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Investigator|LEVEL:2')
      .replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Investigator=2')
      .replace('STAT:INT|SCORE:10', 'STAT:INT|SCORE:14');
    const c = makePcgCharacter(invPcg, { id: 'char', ownerId: ALICE.id });
    act(alice, characterActions.import.create({ character: c }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'hero', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'char', tokenId: 'hero' }));

    // Equip 3 rings -> oldest evicted to carried (PF1e max 2 rings).
    for (const id of ['r1', 'r2', 'r3']) {
      act(alice, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id, name: `Ring ${id}` }) }));
      act(alice, inventoryActions.setSlot.create({ characterId: 'char', itemId: id, slot: 'ring' }));
    }
    const slots = () => room.currentState.characters.char!.inventory.loadouts[0]!.slots;
    assert.equal(slots().r1, 'carried');
    assert.equal(slots().r2, 'ring');
    assert.equal(slots().r3, 'ring');

    // Torch lit -> syncs to token; putting lit torch in Backpack extinguishes token light.
    act(alice, inventoryActions.addItem.create({ characterId: 'char', item: makeItem({ id: 'torch', name: 'Torch', light: { bright: 20, dim: 40 } }) }));
    act(alice, inventoryActions.setLit.create({ characterId: 'char', itemId: 'torch', lit: true }));
    act(alice, characterSheetActions.syncToken.create({ id: 'char' }));
    assert.equal(room.currentState.tokens.hero!.light?.bright, 4);
    const packId = room.currentState.characters.char!.inventory.items.find((i) => i.name === 'Backpack')!.id;
    act(alice, inventoryActions.moveItem.create({ characterId: 'char', itemId: 'torch', containerId: packId }));
    act(alice, characterSheetActions.syncToken.create({ id: 'char' }));
    assert.equal(room.currentState.tokens.hero!.light, null, 'stowing lit torch inside backpack darkens token');

    // Party loot: GM adds unidentified item, Alice takes it, GM identifies, Alice gives back.
    act(gm, lootActions.create.create({ id: 'wand1', item: { name: 'Ivory Wand', imageUrl: null, quantity: 1, value: '750 gp', holderId: null, notes: 'Warm to the touch' } }));
    act(gm, lootActions.setSecret.create({ id: 'wand1', secretNotes: 'Wand of Cure Light Wounds (50 ch)' }));
    act(alice, inventoryActions.takeLoot.create({ lootId: 'wand1', characterId: 'char', itemId: 'invWand', quantity: 1 }));
    assert.equal(room.currentState.loot.wand1!.stowed, true);
    assert.equal(redactState(room.currentState, ALICE).loot.wand1!.secretNotes, '');
    act(gm, lootActions.setIdentified.create({ id: 'wand1', identified: true }));
    assert.equal(redactState(room.currentState, ALICE).loot.wand1!.secretNotes, 'Wand of Cure Light Wounds (50 ch)');
    act(alice, inventoryActions.giveToLoot.create({ characterId: 'char', itemId: 'invWand', quantity: 1, newLootId: 'unused' }));
    assert.equal(room.currentState.loot.wand1!.stowed, false);
    assert.equal(room.currentState.loot.wand1!.quantity, 1);

    // Skills override + Investigator Inspiration spending & Rest restore.
    act(alice, characterSheetActions.updateSheet.create({ id: 'char', changes: { skills: { 'Profession (Detective)': { ranks: 2, misc: 1, classSkill: true, favorite: true, custom: true } } } }));
    const ch = () => room.currentState.characters.char!;
    const det = computeSkills(ch(), computeCharacterStats(ch())).rows.find((r) => r.name === 'Profession (Detective)')!;
    assert.equal(det.total.total, 2 + 3 + 1 + 1, '2 ranks + 3 class + 1 Wis + 1 misc');

    act(alice, pf1eTurnActions.act.create({ actionId: 'c.investigator.inspire', characterId: 'char', chatId: newId() }));
    assert.equal(characterResources(ch()).find((r) => r.def.id === 'inspiration')!.used, 1);
    act(bob, pf1eTurnActions.resetUses.create({ characterId: 'char' }));
    assert.ok(bob.rejects().includes("You don't control that character"));
    act(alice, pf1eTurnActions.resetUses.create({ characterId: 'char' }));
    assert.equal(characterResources(ch()).find((r) => r.def.id === 'inspiration')!.used, 0);
  });
});
