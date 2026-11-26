import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  characterActions,
  CharacterRuntimeSchema,
  combatActions,
  createInitialState,
  createToken,
  CURRENT_SCHEMA_VERSION,
  GameStateSchema,
  inventoryActions,
  ItemWeaponSchema,
  makeItem,
  migrateState,
  newId,
  pf1eTurnActions,
  sceneActions,
  tokenActions,
  tokenSyncFor,
} from '@vtt/shared';
import { ALICE, createRoomFixture, makePcgCharacter, SAMPLE_PCG, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  if (fx) {
    await fx.cleanup();
    fx = null;
  }
});

describe('regression: schema migrations (v1 -> latest) & schema bounds invariants', () => {
  test('migrates v1, v4, v5, v6 and v7 room snapshots cleanly up to CURRENT_SCHEMA_VERSION', () => {
    const base = createInitialState('s1');
    const c = makePcgCharacter(SAMPLE_PCG, { id: 'c1', ownerId: 'u1' });

    // v1 -> latest
    const v1 = {
      schemaVersion: 1,
      users: { u1: { id: 'u1', name: 'GM', role: 'gm', color: '#ff0000' } },
      scenes: {
        s1: {
          id: 's1', name: 'Main', width: 700, height: 700, background: null, backgroundColor: '#000000',
          grid: base.scenes.s1!.grid,
        },
      },
      sceneOrder: ['s1'],
      activeSceneId: 's1',
      tokens: {
        t1: { id: 't1', sceneId: 's1', name: 'Hero', imageUrl: null, color: '#ff0000', x: 0, y: 0, size: 1, ownerIds: [], hidden: false, showName: true },
      },
      chat: [],
    };
    const m1 = migrateState(v1);
    assert.equal(m1.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(m1.characters, {});
    assert.deepEqual(m1.pf1eTurns, {});

    // v4 -> latest (character without sheet, inventory, abilityDamage/Drain/Temp; room without pf1eTurns; loot without stowed)
    const v4Char: Record<string, unknown> = { ...c, runtime: { hp: null, uses: {} } };
    delete v4Char.sheet;
    delete v4Char.inventory;
    const v4: Record<string, unknown> = {
      ...base,
      schemaVersion: 4,
      characters: { c1: v4Char },
      loot: { l1: { id: 'l1', name: 'Coin', imageUrl: null, quantity: 1, value: '1 gp', holderId: null, notes: '', identified: false, secretNotes: '', createdBy: 'u1', createdAt: 1 } },
    };
    delete v4.pf1eTurns;
    const m4 = migrateState(v4);
    assert.equal(m4.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(m4.characters.c1!.sheet.skills, {});
    assert.equal(m4.characters.c1!.inventory.items.length, 3);
    assert.equal(m4.loot.l1!.stowed, false);
    assert.deepEqual(m4.pf1eTurns, {});
  });

  test('extreme character values stay within TokenSchema, CombatantSchema and ChatCardSchema bounds', () => {
    fx = createRoomFixture();
    const { room, gm, alice, act } = fx;
    act(gm, sceneActions.updateGrid.create({ id: 'scene1', changes: { unitsPerCell: 1 } }));

    const c = makePcgCharacter(SAMPLE_PCG, { id: 'extreme', ownerId: ALICE.id });
    c.name = 'X'.repeat(80);
    c.sheet.darkvision = 600;
    c.sheet.misc.initiative = 500;
    c.sheet.misc.hp = 1000;
    c.inventory.items.push(makeItem({ id: 'sun', name: 'Sun', light: { bright: 900, dim: 1800 }, lit: true }));

    act(alice, characterActions.import.create({ character: c }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 'tok', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(gm, combatActions.add.create({ combatant: { id: 'cb', name: 'Old', tokenId: 'tok', initiative: null, modifier: 0, hidden: false } }));
    act(alice, characterActions.linkToken.create({ id: 'extreme', tokenId: 'tok' }));
    act(alice, pf1eTurnActions.act.create({ actionId: 'g.startfull', combatantId: 'cb', chatId: newId() }));

    const tok = room.currentState.tokens.tok!;
    assert.equal(tok.name.length, 60);
    assert.equal(tok.darkvision, 200);
    assert.equal(tok.light?.bright, 200);
    assert.equal(tok.light?.dim, 400);
    assert.equal(room.currentState.combat.combatants[0]!.modifier, 100);
    assert.ok(room.currentState.chat.at(-1)!.card!.title.length <= 120);
    assert.doesNotThrow(() => GameStateSchema.parse(room.currentState), 'persisted state remains 100% schema-valid');

    // tokenSyncFor handles zero/negative unitsPerCell gracefully.
    const badScene = createInitialState('s1');
    badScene.scenes.s1!.grid.unitsPerCell = 0;
    assert.ok(tokenSyncFor(badScene, c, tok).darkvision <= 200);
  });

  test('schema rejects negative ability damage/drain and zero-count/zero-side weapon dice; updateItem normalizes lit & charges', () => {
    assert.equal(CharacterRuntimeSchema.safeParse({ hp: null, uses: {}, abilityDamage: { STR: -1 }, abilityDrain: {}, abilityTemp: {} }).success, false);
    assert.equal(CharacterRuntimeSchema.safeParse({ hp: null, uses: {}, abilityDamage: {}, abilityDrain: { DEX: -2 }, abilityTemp: {} }).success, false);
    assert.equal(ItemWeaponSchema.shape.damage.safeParse('0d6').success, false);
    assert.equal(ItemWeaponSchema.shape.damage.safeParse('1d0').success, false);
    assert.equal(ItemWeaponSchema.shape.damage.safeParse('2d6').success, true);

    fx = createRoomFixture();
    const { room, alice, act } = fx;
    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'c', ownerId: ALICE.id }) }));
    act(alice, inventoryActions.addItem.create({ characterId: 'c', item: makeItem({ id: 'torch', name: 'Torch', light: { bright: 20, dim: 40 }, lit: true }) }));
    act(alice, inventoryActions.updateItem.create({ characterId: 'c', itemId: 'torch', changes: { light: null, charges: { current: 99, max: 10 } } }));
    const item = room.currentState.characters.c!.inventory.items.find((i) => i.id === 'torch')!;
    assert.equal(item.lit, false);
    assert.deepEqual(item.charges, { current: 10, max: 10 });
  });

  test('deleting a linked token directly saves its live HP back onto character.runtime.hp', () => {
    fx = createRoomFixture();
    const { room, gm, alice, act } = fx;
    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'c1', ownerId: ALICE.id }) }));
    act(gm, tokenActions.create.create({ token: createToken({ id: 't1', sceneId: 'scene1', x: 0, y: 0, ownerIds: [ALICE.id] }) }));
    act(alice, characterActions.linkToken.create({ id: 'c1', tokenId: 't1' }));
    act(alice, tokenActions.update.create({ id: 't1', changes: { hp: { value: 7, max: 29, temp: 4 } } }));
    act(alice, tokenActions.remove.create({ id: 't1' }));
    assert.equal(room.currentState.characters.c1!.tokenId, null);
    assert.deepEqual(room.currentState.characters.c1!.runtime.hp, { current: 7, temp: 4, nonlethal: 0 });
  });
});
