import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { characterActions, characterSheetActions, chatActions, computeCharacterStats, pf1eTurnActions, redactState } from '@vtt/shared';
import { BOB, createRoomFixture, makePcgCharacter, SAMPLE_PCG, type RoomFixture } from '../helpers/harness';

const BARBARIAN = SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Barbarian|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Barbarian=1');

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

function setup() {
  fx = createRoomFixture();
  const c = makePcgCharacter(BARBARIAN, { id: 'barb' });
  fx.act(fx.alice, characterActions.import.create({ character: c }));
  return fx;
}

describe('[Epic 6] resource pools, ability cards and combat toggles in a room', () => {
  test('spend and restore class resources, clamped to the pool; others cannot touch it', () => {
    const { room, alice, bob, act } = setup();
    const uses = () => room.currentState.characters.barb!.runtime.uses;
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'barbarian.rage', delta: 2 }));
    assert.equal(uses()['barbarian.rage'], 2);
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'barbarian.rage', delta: 100 }));
    assert.equal(uses()['barbarian.rage'], 6, 'clamped to 4 + Con 2 rounds');
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'barbarian.rage', delta: -100 }));
    assert.equal(uses()['barbarian.rage'], undefined, 'fully restored');

    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'wizard.school', delta: 1 }));
    assert.ok(alice.rejects().includes('Unknown resource'));
    const bobBefore = bob.inbox.length;
    act(bob, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'barbarian.rage', delta: 1 }));
    assert.ok(bob.rejects().includes("You don't control that character"));
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'barbarian.rage', delta: 1 }));
    assert.equal(bob.inbox.slice(bobBefore).filter((m) => m.t === 'action').length, 0, 'unshared character: Bob gets nothing');
  });

  test('custom pools from the sheet, and Rest restores everything', () => {
    const { room, alice, act } = setup();
    act(alice, characterSheetActions.updateSheet.create({ id: 'barb', changes: { customPools: [{ id: 'ki', name: 'Ki', max: 3, unit: 'points' }] } }));
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'custom.ki', delta: 5 }));
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'barb', key: 'barbarian.rage', delta: 1 }));
    assert.deepEqual(room.currentState.characters.barb!.runtime.uses, { 'custom.ki': 3, 'barbarian.rage': 1 });
    act(alice, pf1eTurnActions.resetUses.create({ characterId: 'barb' }));
    assert.deepEqual(room.currentState.characters.barb!.runtime.uses, {});
  });

  test('ability cards follow the chat mode: GM-only cards stay away from other players', () => {
    const { room, alice, act } = setup();
    act(alice, chatActions.card.create({ id: 'c1', card: { title: 'Rage', subtitle: 'Barbarian 1', text: 'Fly into a rage.' } }));
    act(alice, chatActions.card.create({ id: 'c2', card: { title: 'Secret trait' }, whisper: { mode: 'gm', to: [] } }));
    const bobView = redactState(room.currentState, BOB).chat.map((m) => m.card?.title);
    assert.ok(bobView.includes('Rage') && !bobView.includes('Secret trait'));
  });

  test('combat toggles saved on the character change its numbers for everyone who sees it', () => {
    const { room, alice, act } = setup();
    const before = computeCharacterStats(room.currentState.characters.barb!);
    act(alice, characterSheetActions.updateRuntime.create({ id: 'barb', changes: { toggles: { powerAttack: true, fightDefensively: true } } }));
    const after = computeCharacterStats(room.currentState.characters.barb!);
    assert.deepEqual(after.toggles.sort(), ['fightDefensively', 'powerAttack']);
    assert.equal(after.ac.normal.total, before.ac.normal.total + 2);
    assert.equal(after.attacks[0]!.attack.total, before.attacks[0]!.attack.total - 1 - 4);
  });
});
