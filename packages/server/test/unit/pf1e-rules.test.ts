import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  babFor,
  baseSaveFor,
  carryingCapacity,
  coinsFromGp,
  coinsValue,
  describeLine,
  detectGear,
  enhancementFrom,
  featKey,
  formatGpValue,
  lookupArmor,
  lookupClass,
  lookupFeatEffects,
  lookupRace,
  lookupWeapon,
  parseGpValue,
  payFromPurse,
  signed,
  sizedDamage,
  sumModifiers,
} from '@vtt/shared';

describe('unit: PF1e modifier stacking', () => {
  test('takes highest of same bonus type; stacks dodge, circumstance, untyped, base, ability and penalties', () => {
    const line = sumModifiers([
      { value: 10, type: 'base', source: 'Base' },
      { value: 2, type: 'deflection', source: 'Ring +2' },
      { value: 4, type: 'deflection', source: 'Shield of Faith' },
      { value: 1, type: 'dodge', source: 'Dodge' },
      { value: 2, type: 'dodge', source: 'Fighting Defensively' },
      { value: 2, type: 'circumstance', source: 'Aid' },
      { value: 2, type: 'circumstance', source: 'High Ground' },
      { value: -2, type: 'morale', source: 'Shaken' },
      { value: -1, type: 'morale', source: 'Bane' },
      { value: 0, type: 'untyped', source: 'Ignored Zero' },
    ]);
    assert.equal(line.total, 10 + 4 + 1 + 2 + 2 + 2 - 2 - 1);
    assert.equal(line.parts.some((p) => p.source === 'Ignored Zero'), false);
    assert.equal(line.parts.find((p) => p.source === 'Ring +2')?.applied, false);
    assert.ok(describeLine(line).includes('Ring +2 +2 (doesn’t stack)'));
    assert.equal(signed(0), '+0');
    assert.equal(signed(-3), '-3');
  });
});

describe('unit: PF1e classes, races, armor & feats tables', () => {
  test('BAB and base saves match PF1e Core and Prestige progressions', () => {
    assert.equal(babFor('full', 7), 7);
    assert.equal(babFor('threeQuarter', 7), 5);
    assert.equal(babFor('half', 7), 3);
    assert.equal(baseSaveFor(true, 1, false), 2);
    assert.equal(baseSaveFor(true, 6, false), 5);
    assert.equal(baseSaveFor(false, 6, false), 2);
    assert.equal(baseSaveFor(true, 1, true), 1);
    assert.equal(baseSaveFor(true, 2, true), 1);
    assert.equal(baseSaveFor(true, 3, true), 2);
    assert.equal(baseSaveFor(false, 1, true), 0);
    assert.equal(baseSaveFor(false, 2, true), 1);
    assert.equal(baseSaveFor(false, 5, true), 2);
    assert.equal(baseSaveFor(true, 0, false), 0);
  });

  test('resolves core, hybrid, occult, unchained and NPC classes plus race aliases', () => {
    assert.equal(lookupClass('Fighter')?.hd, 10);
    assert.equal(lookupClass('Monk (Unchained)')?.bab, 'full');
    assert.equal(lookupClass('Unchained Barbarian')?.hd, 12);
    assert.equal(lookupClass('Kineticist')?.bab, 'threeQuarter');
    assert.equal(lookupClass('Commoner')?.goodSaves.length, 0);
    assert.equal(lookupClass('Homebrew Prestige'), undefined);

    assert.equal(lookupRace('Core Human')?.anyPlusTwo, true);
    assert.equal(lookupRace('Featured Aasimar')?.darkvision, 60);
    assert.equal(lookupRace('Android')?.lowLight, true);
    assert.equal(lookupRace('Strix')?.lowLight, true);
    assert.equal(lookupRace('Dwarf')?.steady, true);
    assert.equal(lookupRace('Unknown Alien'), undefined);
  });

  test('lookupArmor handles PCGen shield aliases, enhancement bonuses and rejects non-armor leather gear', () => {
    assert.deepEqual(lookupArmor('+2 Studded Leather')?.armor.name, 'Studded leather');
    assert.equal(lookupArmor('+2 Studded Leather')?.enhancement, 2);
    assert.equal(lookupArmor('Shield (Small/Wood)')?.armor.name, 'Light wooden shield');
    assert.equal(lookupArmor('Shield (Large/Steel)')?.armor.name, 'Heavy steel shield');
    assert.equal(lookupArmor('Leather Boots'), undefined);
    assert.equal(lookupArmor('Hide Shirt'), undefined);
    assert.equal(lookupArmor('Waterskin (Leather)'), undefined);
  });

  test('featKey normalizes traits and parenthetical qualifiers', () => {
    assert.equal(featKey('Trait ~ Reactionary'), 'reactionary');
    assert.equal(featKey('Toughness (Mythic)'), 'toughness');
    assert.equal(lookupFeatEffects('Trait ~ Reactionary')?.[0]?.type, 'trait');
    assert.equal(lookupFeatEffects('Fleet')?.[0]?.lightArmorOnly, true);
    assert.equal(lookupFeatEffects('Fleet')?.[0]?.stackable, true);
  });
});

describe('unit: PF1e gear detection, weapon sizing, capacity & currency', () => {
  test('detectGear recognizes weapons, PCGen aliases, magic/masterwork armor, lights, containers and charges', () => {
    const sword = detectGear('+1 Longsword (Cold Iron)');
    assert.equal(sword.weapon?.damage, '1d8');
    assert.equal(sword.weapon?.enhancement, 1);
    assert.equal(sword.weapon?.masterwork, true);

    assert.equal(lookupWeapon('Shortsword')?.damage, '1d6');
    assert.equal(lookupWeapon('Sword (Short)')?.damage, '1d6');
    assert.equal(lookupWeapon('Crossbow (Light)')?.damage, '1d8');
    assert.equal(lookupWeapon('Longbow (Composite)')?.strDamage, 'full');
    assert.equal(enhancementFrom('Composite Longbow (+3 Str)'), 0);
    assert.equal(enhancementFrom('+2 Composite Longbow (+3 Str)'), 2);
    assert.equal(detectGear('Wand of Acid Arrow').weapon, null);
    assert.equal(detectGear('Wand of Acid Arrow').charges?.max, 50);
    assert.equal(detectGear('Spell Component Pouch').container, null);
    assert.equal(detectGear('Bag of Holding (Type III)').container?.capacity, 1000);
    assert.equal(detectGear('Bullseye Lantern').light?.dim, 120);
  });

  test('sizedDamage scales across Fine through Colossal accurately', () => {
    assert.equal(sizedDamage('1d8', 'Fine'), '1d2');
    assert.equal(sizedDamage('1d8', 'Tiny'), '1d4');
    assert.equal(sizedDamage('1d8', 'Small'), '1d6');
    assert.equal(sizedDamage('1d8', 'Medium'), '1d8');
    assert.equal(sizedDamage('1d8', 'Large'), '2d6');
    assert.equal(sizedDamage('1d8', 'Huge'), '3d6');
    assert.equal(sizedDamage('1d8', 'Gargantuan'), '4d6');
    assert.equal(sizedDamage('1d8', 'Colossal'), '6d6');
    assert.equal(sizedDamage('2d6', 'Huge'), '4d6');
  });

  test('carryingCapacity handles Medium, Small, Large, Fine and Str > 29', () => {
    assert.deepEqual(carryingCapacity(10, 'Medium'), { light: 33, medium: 66, heavy: 100 });
    assert.deepEqual(carryingCapacity(10, 'Small'), { light: 25, medium: 50, heavy: 75 });
    assert.deepEqual(carryingCapacity(10, 'Large'), { light: 66, medium: 133, heavy: 200 });
    assert.equal(carryingCapacity(30, 'Medium').heavy, 1600);
    assert.equal(carryingCapacity(40, 'Medium').heavy, 6400);
    assert.equal(carryingCapacity(0, 'Medium').heavy, 0);
  });

  test('coins conversion, change-making and gp text parsing', () => {
    assert.deepEqual(coinsFromGp(12.34), { pp: 0, gp: 12, sp: 3, cp: 4 });
    assert.equal(coinsValue({ pp: 2, gp: 5, sp: 4, cp: 3 }), 25.43);
    assert.deepEqual(payFromPurse({ pp: 1, gp: 0, sp: 0, cp: 0 }, 25), { pp: 0, gp: 9, sp: 7, cp: 5 });
    assert.equal(payFromPurse({ pp: 0, gp: 0, sp: 5, cp: 0 }, 51), null);
    assert.equal(parseGpValue('2,315 gp'), 2315);
    assert.equal(parseGpValue('12,5 gp'), 12.5);
    assert.equal(parseGpValue('2 pp 5 sp 3 cp'), 20.53);
    assert.equal(parseGpValue('3 gems'), 0);
    assert.equal(formatGpValue(315.5), '315.5 gp');
    assert.equal(formatGpValue(0), '');
  });
});
