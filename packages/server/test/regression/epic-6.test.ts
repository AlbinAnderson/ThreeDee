import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  acrobaticsRanks,
  activeToggles,
  characterAbilities,
  characterActions,
  CharacterRuntimeSchema,
  characterSheetActions,
  CharacterSheetSchema,
  computeCharacterStats,
  createInitialState,
  CURRENT_SCHEMA_VERSION,
  EMPTY_RUNTIME,
  EMPTY_SHEET,
  makeItem,
  migrateState,
  pf1eTurnActions,
  toggleAttackPenalty,
  weaponKey,
} from '@vtt/shared';
import { createRoomFixture, makePcgCharacter, SAMPLE_PCG, withPcgLines, type RoomFixture } from '../helpers/harness';

let fx: RoomFixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

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

  test('Weapon Focus uses canonical weapon matching: no substring false positives and handles Shortsword / Composite Longbow / legacy multi-targets', () => {
    // The sample has Weapon Focus (Longsword, Shortsword) and wields a masterwork longsword.
    const c = makePcgCharacter();
    const sword = computeCharacterStats(c).attacks[0]!;
    assert.ok(sword.attack.parts.some((p) => p.source === 'Weapon Focus'));
    c.inventory.items[0]!.name = 'Masterwork Battleaxe';
    assert.ok(!computeCharacterStats(c).attacks[0]!.attack.parts.some((p) => p.source === 'Weapon Focus'));

    // PCGen "Sword (Short)" matches "Weapon Focus (Shortsword)".
    c.inventory.items[0]!.name = 'Sword (Short)';
    assert.ok(computeCharacterStats(c).attacks[0]!.attack.parts.some((p) => p.source === 'Weapon Focus'));

    // Canonical weapon keys prevent substring false positives and unify composite bows.
    assert.equal(weaponKey('Punching Dagger') === weaponKey('Dagger'), false);
    assert.equal(weaponKey('Heavy Flail') === weaponKey('Flail'), false);
    assert.equal(weaponKey('Boar Spear') === weaponKey('Spear'), false);
    assert.equal(weaponKey('+1 Composite Longbow (+3 Str)'), weaponKey('Longbow'));
    assert.equal(weaponKey('Sword (Short)'), weaponKey('Shortsword'));

    // Weapon Focus (Dagger) must not match Punching Dagger; legacy comma-separated targets match each weapon.
    const wf = makePcgCharacter(
      withPcgLines(
        SAMPLE_PCG.replace(/^ABILITY:FEAT\|.*KEY:Weapon Focus.*$/m, ''),
        'FEAT:Weapon Focus (Dagger, Longbow)',
      ),
    );
    wf.inventory.items[0]!.name = 'Masterwork Punching Dagger';
    assert.ok(!computeCharacterStats(wf).attacks[0]!.attack.parts.some((p) => p.source === 'Weapon Focus'));
    wf.inventory.items[0]!.name = 'Composite Longbow (+2 Str)';
    assert.ok(computeCharacterStats(wf).attacks[0]!.attack.parts.some((p) => p.source === 'Weapon Focus'));
  });

  test('activeToggles enforces mutual exclusion directly and melee toggles penalize CMB; Piranha Strike requires light melee weapon', () => {
    const c = makePcgCharacter(
      withPcgLines(
        SAMPLE_PCG,
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Piranha Strike|TYPE:Combat',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Combat Expertise|TYPE:Combat',
      ),
    );
    const base = computeCharacterStats(c);

    // Crafted runtime.toggles combining mutually exclusive options: Total defense drops fightDefensively & combatExpertise; Power Attack drops Piranha Strike.
    c.runtime.toggles = { totalDefense: true, fightDefensively: true, combatExpertise: true, powerAttack: true, piranhaStrike: true };
    const active = activeToggles(c);
    assert.ok(active.has('totalDefense'));
    assert.ok(!active.has('fightDefensively'));
    assert.ok(!active.has('combatExpertise'));
    assert.ok(active.has('powerAttack'));
    assert.ok(!active.has('piranhaStrike'));
    const statsDirect = computeCharacterStats(c);
    assert.equal(statsDirect.ac.normal.total, base.ac.normal.total + 4, 'only Total defense dodge AC applies');
    assert.equal(statsDirect.cmb.total, base.cmb.total - 1, 'Power Attack penalizes CMB');

    // Combat Expertise + Fighting defensively stack on melee attacks AND CMB.
    c.runtime.toggles = { combatExpertise: true, fightDefensively: true };
    const ceFd = computeCharacterStats(c);
    assert.equal(ceFd.cmb.total, base.cmb.total - 1 - 4);
    assert.equal(toggleAttackPenalty(ceFd.toggles, ceFd.bab.total, true), -5);
    assert.equal(toggleAttackPenalty(ceFd.toggles, ceFd.bab.total, false), -4);

    // Piranha Strike applies to a light weapon (Dagger) and NOT a one-handed finesse weapon (Rapier).
    c.inventory.items.push(
      makeItem({ id: 'rap', name: 'Rapier', weapon: { damage: '1d6', critRange: 18, critMult: 2, range: 0, type: 'melee', hands: 'one', strDamage: 'full', finesse: true, enhancement: 0, masterwork: false } }),
      makeItem({ id: 'dag', name: 'Dagger', weapon: { damage: '1d4', critRange: 19, critMult: 2, range: 0, type: 'melee', hands: 'light', strDamage: 'full', finesse: true, enhancement: 0, masterwork: false } }),
    );
    c.inventory.loadouts[0]!.slots = { rap: 'primary', dag: 'offHand' };
    c.runtime.toggles = { piranhaStrike: true };
    const ps = computeCharacterStats(c);
    const rap = ps.attacks.find((a) => a.itemId === 'rap')!;
    const dag = ps.attacks.find((a) => a.itemId === 'dag')!;
    // Piranha Strike: penalty applies to all melee attacks while wielding a light weapon, bonus damage ONLY to light weapons.
    assert.ok(rap.attack.parts.some((p) => p.source === 'Piranha Strike' && p.value === -1), 'all melee attacks take Piranha Strike penalty when dual-wielding a light weapon');
    assert.ok(!rap.damage.parts.some((p) => p.source === 'Piranha Strike'), 'Rapier is one-handed, not light: no Piranha Strike damage');
    assert.ok(dag.attack.parts.some((p) => p.source === 'Piranha Strike'), 'Dagger is a light weapon');
    assert.ok(dag.damage.parts.some((p) => p.source === 'Piranha Strike' && p.value === 1), 'off-hand Piranha Strike +1');
    // Without any light melee weapon wielded, Rapier takes neither penalty nor damage.
    c.inventory.loadouts[0]!.slots = { rap: 'primary' };
    const rapOnly = computeCharacterStats(c).attacks.find((a) => a.itemId === 'rap')!;
    assert.ok(!rapOnly.attack.parts.some((p) => p.source === 'Piranha Strike'), 'Rapier alone is not eligible for Piranha Strike');
  });

  test('abilities catalog categorizes Class Feature and Racial Trait accurately and deduplicates legacy/virtual feats', () => {
    const c = makePcgCharacter(
      withPcgLines(
        SAMPLE_PCG,
        'ABILITY:Fighter Class Features|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Bravery|DESC:+1 vs fear.',
        'ABILITY:Human Racial Trait|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Human Racial Trait ~ Dual Talent|DESC:+2 to two stats.',
        'ABILITY:Race Trait|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Heirloom Weapon|DESC:Wield an inherited weapon.',
        'FEAT:Power Attack',
        'VFEAT:Power Attack',
      ),
    );
    const list = characterAbilities(c);
    assert.equal(list.find((a) => a.name === 'Bravery')?.category, 'class', 'Class Features pool is class, not feat');
    assert.equal(list.find((a) => a.name === 'Dual Talent')?.category, 'racial', 'Racial Trait pool is racial, not trait');
    assert.equal(list.find((a) => a.name === 'Heirloom Weapon')?.category, 'trait', 'Race Trait is a character trait');
    assert.equal(list.filter((a) => a.category === 'feat' && a.name === 'Power Attack').length, 1, 'no duplicate Power Attack across abilities & legacy/virtual feats');
  });

  test('acrobaticsRanks matches sheet overrides case-insensitively', () => {
    const c = makePcgCharacter();
    c.sheet.skills = { acrobatics: { ranks: 4, misc: 0, classSkill: null, favorite: false, custom: false } };
    assert.equal(acrobaticsRanks(c), 4);
  });

  test('schema rejects duplicate customPool ids and >200 runtime.uses keys; removing/shrinking custom pool prunes/clamps runtime.uses', () => {
    const dup = CharacterSheetSchema.safeParse({
      ...EMPTY_SHEET,
      customPools: [
        { id: 'ki', name: 'Ki', max: 3, unit: 'points' },
        { id: 'ki', name: 'Other', max: 2, unit: 'uses' },
      ],
    });
    assert.equal(dup.success, false);

    const tooManyUses = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, 1]));
    assert.equal(CharacterRuntimeSchema.safeParse({ ...EMPTY_RUNTIME, uses: tooManyUses }).success, false);

    fx = createRoomFixture();
    const { room, alice, act } = fx;
    act(alice, characterActions.import.create({ character: makePcgCharacter(SAMPLE_PCG, { id: 'monk' }) }));
    act(alice, characterSheetActions.updateSheet.create({ id: 'monk', changes: { customPools: [{ id: 'ki', name: 'Ki', max: 5, unit: 'points' }, { id: 'pan', name: 'Panache', max: 4, unit: 'points' }] } }));
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'monk', key: 'custom.ki', delta: 4 }));
    act(alice, pf1eTurnActions.adjustUse.create({ characterId: 'monk', key: 'custom.pan', delta: 3 }));
    // Shrink Ki to max 2 and remove Panache.
    act(alice, characterSheetActions.updateSheet.create({ id: 'monk', changes: { customPools: [{ id: 'ki', name: 'Ki', max: 2, unit: 'points' }] } }));
    assert.deepEqual(room.currentState.characters.monk!.runtime.uses, { 'custom.ki': 2 });
  });
});
