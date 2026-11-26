import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  characterHp,
  characterSheetActions,
  combatActions,
  computeCharacterStats,
  createScene,
  createToken,
  inventoryActions,
  makeItem,
  parsePcg,
  sceneActions,
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

describe('feature: character lifecycle, token sync, re-import & persistence', () => {
  test('import -> link -> live HP -> re-import -> share/unshare -> setOwner -> scene delete -> DB reload', async () => {
    fx = createRoomFixture();
    const { room, store, gm, alice, bob, act } = fx;

    const c = makePcgCharacter(SAMPLE_PCG, { id: 'val', ownerId: ALICE.id });
    act(alice, characterActions.import.create({ character: c }));
    assert.ok(!bob.json().includes('Valeros'), 'private character hidden from Bob');

    // Create scene2 + token, link character, add to combat.
    act(gm, sceneActions.create.create({ scene: createScene('scene2', 'Arena') }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tokVal', sceneId: 'scene2', x: 0, y: 0, name: 'Generic' }) }));
    act(gm, combatActions.add.create({ combatant: { id: 'cbVal', name: 'Generic', tokenId: 'tokVal', initiative: null, modifier: 0, hidden: false } }));
    act(gm, characterActions.linkToken.create({ id: 'val', tokenId: 'tokVal' }));

    const tok = () => room.currentState.tokens.tokVal!;
    assert.ok(tok().ownerIds.includes(ALICE.id), 'GM linking player character grants token ownership');
    assert.equal(tok().name, 'Valeros & Friends');
    assert.equal(room.currentState.combat.combatants[0]!.name, 'Valeros & Friends');

    // Live damage on token reflects in characterHp.
    const statsBefore = computeCharacterStats(room.currentState.characters.val!);
    act(alice, tokenActions.update.create({ id: 'tokVal', changes: { hp: { value: 9, max: statsBefore.hp.total, temp: 3 } } }));
    assert.deepEqual(characterHp(room.currentState, room.currentState.characters.val!, statsBefore.hp.total), {
      current: 9,
      temp: 3,
      nonlethal: 0,
      fromToken: true,
    });

    // Customize name, add VTT-owned gear & skill override, then re-import level-up.
    act(alice, characterActions.update.create({ id: 'val', changes: { name: 'Valeros the Bold' } }));
    act(alice, inventoryActions.addItem.create({ characterId: 'val', item: makeItem({ id: 'potion', name: 'Healing Potion', quantity: 2 }) }));
    act(alice, characterSheetActions.updateSheet.create({ id: 'val', changes: { skills: { Perception: { ranks: 3, misc: 2, classSkill: true, favorite: true, custom: false } } } }));

    const leveledBuild = parsePcg(
      SAMPLE_PCG.replace('CLASS:Fighter|LEVEL:2', 'CLASS:Fighter|LEVEL:3').replace('HITPOINTS:7', 'HITPOINTS:15'),
    );
    act(alice, characterActions.reimport.create({ id: 'val', build: leveledBuild, fileName: 'val-lvl4.pcg' }));
    act(alice, characterSheetActions.syncToken.create({ id: 'val' }));

    const afterReimport = room.currentState.characters.val!;
    assert.equal(afterReimport.name, 'Valeros the Bold');
    assert.ok(afterReimport.inventory.items.some((i) => i.id === 'potion'), 'inventory kept on default re-import');
    assert.equal(afterReimport.sheet.skills.Perception?.misc, 2, 'skill overrides kept on re-import');
    assert.equal(tok().hp?.value, 9, 'damaged live HP kept while max HP rises');
    assert.equal(tok().hp?.max, statsBefore.hp.total + 10, 'max HP rises by +8 rolled HP and +2 Con for the new Fighter HD');

    // Share with Bob, then hand character to Bob.
    act(alice, characterActions.update.create({ id: 'val', changes: { shared: true } }));
    assert.ok(bob.json().includes('Valeros the Bold'));
    act(gm, characterActions.setOwner.create({ id: 'val', ownerId: BOB.id }));
    assert.equal(room.currentState.characters.val!.ownerId, BOB.id);

    // Deleting scene2 removes tokVal, removes cbVal from combat, and copies live HP back onto the character.
    act(gm, sceneActions.remove.create({ id: 'scene2' }));
    assert.equal(room.currentState.characters.val!.tokenId, null);
    assert.equal(room.currentState.characters.val!.runtime.hp?.current, 9);
    assert.equal(room.currentState.characters.val!.runtime.hp?.temp, 3);
    assert.equal(room.currentState.combat.combatants.length, 0);

    // Persisted state round-trips through SQLite cleanly.
    await room.flush({ autoSnapshot: false });
    const loaded = await store.load('main');
    assert.equal(loaded!.characters.val!.name, 'Valeros the Bold');
    assert.equal(loaded!.characters.val!.runtime.hp?.current, 9);
  });
});
