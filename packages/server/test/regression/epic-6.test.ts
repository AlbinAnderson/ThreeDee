import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeCharacterStats, createInitialState, CURRENT_SCHEMA_VERSION, migrateState } from '@vtt/shared';
import { makePcgCharacter } from '../helpers/harness';

describe('[Epic 6] regressions', () => {
  test('v8 -> v9 migration adds combat toggles and custom pools', () => {
    const c = makePcgCharacter(undefined, { id: 'x' }) as unknown as { sheet: Record<string, unknown>; runtime: Record<string, unknown> };
    delete c.sheet.customPools;
    delete c.runtime.toggles;
    const migrated = migrateState({ ...createInitialState('s1'), schemaVersion: 8, characters: { x: c } });
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.characters.x!.sheet.customPools, []);
    assert.deepEqual(migrated.characters.x!.runtime.toggles, {});
  });

  test('Weapon Focus applies only to its chosen weapon', () => {
    // The sample has Weapon Focus (Longsword, Shortsword) and wields a masterwork longsword.
    const c = makePcgCharacter();
    const sword = computeCharacterStats(c).attacks[0]!;
    assert.ok(sword.attack.parts.some((p) => p.source === 'Weapon Focus'));
    c.inventory.items[0]!.name = 'Masterwork Battleaxe';
    assert.ok(!computeCharacterStats(c).attacks[0]!.attack.parts.some((p) => p.source === 'Weapon Focus'));
  });
});
