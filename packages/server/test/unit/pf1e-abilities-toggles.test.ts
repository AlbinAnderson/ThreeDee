import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { characterAbilities, characterPools, computeCharacterStats, makeItem, setToggle, availableToggles, toggleStep } from '@vtt/shared';
import { makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

// Real ability lines from a PCGen 6.08 character (Android Alchemist).
const DANNOG_ABILITIES = [
  'ABILITY:*LANGBONUS|TYPE:VIRTUAL|CATEGORY:*LANGBONUS|KEY:*LANGBONUS|APPLIEDTO:Orc,Hallit,Androffan|TYPE:',
  'ABILITY:Alchemist Archetype|TYPE:NORMAL|CATEGORY:Archetype|KEY:Alchemist Archetype ~ Beastmorph|TYPE:Archetype.AlchemistArchetype|DESC:Beastmorphs study the anatomy of monsters.',
  'ABILITY:Alchemist Discovery|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Discovery ~ Feral Mutagen|TYPE:AlchemistClassFeatures|DESC:Two claws and a bite.',
  'ABILITY:Drawbacks|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Drawback ~ Provincial|TYPE:Drawback|DESC:You grew up somewhere small.',
  'ABILITY:Traits|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Trait ~ Local Ties|APPLIEDTO:Knowledge (Engineering)|TYPE:Trait|DESC:Choose a skill.',
  'ABILITY:Region of Origin|TYPE:NORMAL|CATEGORY:Background|KEY:Numeria|TYPE:Region|DESC:A land of fallen technology.',
  'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Power Attack|TYPE:General.Combat|DESC:Trade accuracy for damage.',
];

describe('[Epic 6] abilities catalog', () => {
  test('categorizes .pcg abilities, cleans names, skips PCGen internals', () => {
    const c = makePcgCharacter(withPcgLines(SAMPLE_PCG, ...DANNOG_ABILITIES));
    const list = characterAbilities(c);
    const by = (name: string) => list.find((a) => a.name === name)!;
    assert.ok(!list.some((a) => a.name.includes('LANGBONUS')));
    assert.equal(by('Beastmorph').category, 'class');
    assert.equal(by('Beastmorph').group, 'Archetype');
    assert.equal(by('Feral Mutagen').group, 'Alchemist Discovery');
    assert.equal(by('Provincial').category, 'trait');
    assert.deepEqual(by('Local Ties').appliedTo, ['Knowledge (Engineering)']);
    assert.equal(by('Numeria').category, 'racial');
    assert.equal(by('Power Attack').group, 'Combat feat');
    assert.ok(by('Power Attack').description?.startsWith('Trade accuracy for damage'));
  });

  test('adds class abilities and racial traits from the rules tables', () => {
    const c = makePcgCharacter(SAMPLE_PCG.replace('RACE:Human', 'RACE:Elf'));
    const list = characterAbilities(c);
    const rules = list.filter((a) => a.source === 'rules');
    assert.ok(rules.some((a) => a.category === 'class' && a.group === 'Wizard 1'), 'wizard level-1 abilities');
    assert.ok(rules.some((a) => a.category === 'racial' && a.name === 'Low-light vision'));
    assert.ok(rules.some((a) => a.name === 'Perception +2'), 'elven keen senses');
    assert.equal(list.filter((a) => a.category === 'proficiency').length, c.build.attributes.weaponProficiencies.length ? 1 : 0);
  });
});

describe('[Epic 6] combat toggles', () => {
  const pa = makePcgCharacter(withPcgLines(SAMPLE_PCG, DANNOG_ABILITIES.at(-1)!, 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Combat Expertise|TYPE:Combat'));

  test('only toggles the character qualifies for', () => {
    const ids = availableToggles(pa).map((t) => t.id);
    assert.ok(ids.includes('powerAttack') && ids.includes('combatExpertise') && ids.includes('fightDefensively'));
    assert.ok(!ids.includes('deadlyAim'));
    // A toggle switched on without the feat is ignored (the sample has Power Attack; remove it).
    const plain = makePcgCharacter(SAMPLE_PCG.replace(/^ABILITY:FEAT\|.*KEY:Power Attack.*$/m, ''));
    const before = computeCharacterStats(plain).attacks[0]!.attack.total;
    plain.runtime.toggles = { powerAttack: true };
    assert.equal(computeCharacterStats(plain).attacks[0]!.attack.total, before);
    assert.ok(!availableToggles(plain).some((t) => t.id === 'powerAttack'));
  });

  test('Power Attack: -1 attack / +2 damage at BAB 2, +3 two-handed', () => {
    assert.equal(toggleStep(2), 1);
    assert.equal(toggleStep(8), 3);
    const c = structuredClone(pa);
    const base = computeCharacterStats(c).attacks[0]!.attack.total;
    assert.equal(base, 7, 'BAB 2 + Str 3 + masterwork + Weapon Focus (Longsword)');
    c.runtime.toggles = { powerAttack: true };
    let sword = computeCharacterStats(c).attacks[0]!;
    assert.equal(sword.attack.total, base - 1);
    assert.equal(sword.damage.total, 3 + 2);
    c.inventory.loadouts[0]!.slots[c.inventory.items[0]!.id] = 'bothHands';
    sword = computeCharacterStats(c).attacks[0]!;
    assert.equal(sword.damage.total, 4 + 3, 'Str x1.5 and Power Attack x1.5');
  });

  test('Combat Expertise, fighting defensively and total defense add dodge AC (not flat-footed)', () => {
    const c = structuredClone(pa);
    const base = computeCharacterStats(c);
    c.runtime.toggles = { combatExpertise: true, fightDefensively: true };
    const s = computeCharacterStats(c);
    assert.equal(s.ac.normal.total, base.ac.normal.total + 1 + 2);
    assert.equal(s.ac.flatFooted.total, base.ac.flatFooted.total);
    assert.equal(s.cmd.total, base.cmd.total + 3, 'dodge bonuses raise CMD too');
    assert.equal(s.attacks[0]!.attack.total, base.attacks[0]!.attack.total - 1 - 4);
    c.runtime.toggles = setToggle(c.runtime.toggles, 'totalDefense', true);
    assert.equal(c.runtime.toggles.fightDefensively, undefined, 'total defense replaces fighting defensively');
    assert.equal(computeCharacterStats(c).ac.normal.total, base.ac.normal.total + 1 + 4);
  });

  test('Deadly Aim and Rapid Shot on a bow', () => {
    const c = makePcgCharacter(
      withPcgLines(SAMPLE_PCG, 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Deadly Aim|TYPE:Combat', 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Rapid Shot|TYPE:Combat'),
    );
    c.inventory.items.push(makeItem({ id: 'bow', name: 'Longbow', weapon: { damage: '1d8', critRange: 20, critMult: 3, range: 100, type: 'ranged', hands: 'two', strDamage: 'penalty', finesse: false, enhancement: 0, masterwork: false } }));
    c.inventory.loadouts[0]!.slots[c.inventory.items[0]!.id] = 'carried';
    c.inventory.loadouts[0]!.slots.bow = 'bothHands';
    const plain = computeCharacterStats(c).attacks.find((a) => a.itemId === 'bow')!;
    c.runtime.toggles = { deadlyAim: true, rapidShot: true };
    const bow = computeCharacterStats(c).attacks.find((a) => a.itemId === 'bow')!;
    assert.equal(bow.attack.total, plain.attack.total - 1);
    assert.equal(bow.damage.total, plain.damage.total + 2);
    assert.deepEqual(bow.fullAttack, [bow.attack.total - 2, bow.attack.total - 2], 'extra attack, all at -2');
  });
});

describe('[Epic 6] resource pools', () => {
  test('class resources and custom pools share one list', () => {
    const c = makePcgCharacter(SAMPLE_PCG.replace('CLASS:Wizard|LEVEL:1', 'CLASS:Barbarian|LEVEL:1').replace('CLASSABILITIESLEVEL:Wizard=1', 'CLASSABILITIESLEVEL:Barbarian=1'));
    c.sheet.customPools = [{ id: 'ki', name: 'Ki', max: 3, unit: 'points' }];
    c.runtime.uses['custom.ki'] = 1;
    const pools = characterPools(c);
    const rage = pools.find((p) => p.name === 'Rage')!;
    assert.equal(rage.max, 4 + 2, 'rage rounds: 4 + Con 2');
    assert.deepEqual(pools.find((p) => p.custom), { key: 'custom.ki', name: 'Ki', unit: 'points', used: 1, max: 3, className: null, custom: true });
  });
});
