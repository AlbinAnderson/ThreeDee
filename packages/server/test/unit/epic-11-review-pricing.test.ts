/**
 * Epic 11 Layer-2 review: PF1e pricing fixes checked against the PCGen
 * Core Rulebook equipmods (cr_equipmods.lst):
 *  - "+1 (Enhancement to Ammunition)": BONUS:ITEMCOST|TYPE.AMMUNITION|40*PLUSTOTAL*PLUSTOTAL (per piece)
 *  - "Cold Iron": BONUS:ITEMCOST|TYPE.Enhancement.AMMUNITION|40 (per piece), weapons +2000
 *  - "Darkwood": COST:WT*10 plus ITEMCOST 300 (weapon) / 150 (shield) / 6 (ammunition)
 *  - COST:0 magic items are priced by EQMOD formulas in PCGen: unknown here, never free.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { baseCost, itemFromRecord, NO_MODS, priceWithMods, type EquipmentRecord } from '@vtt/shared';

function rec(over: Partial<EquipmentRecord>): EquipmentRecord {
  return {
    kind: 'equipment',
    key: over.name ?? 'Thing',
    name: 'Thing',
    source: { campaign: 'Core Rulebook', long: 'Core Rulebook', short: 'CR', page: null },
    desc: '',
    types: [],
    cost: null,
    weight: null,
    baseItem: null,
    damage: null,
    critRange: null,
    critMult: null,
    range: null,
    wield: null,
    acBonus: null,
    maxDex: null,
    acp: null,
    asf: null,
    slot: null,
    cl: null,
    aura: null,
    eqmods: [],
    spellEffect: null,
    ...over,
  };
}

const priced = (r: EquipmentRecord, mods = NO_MODS) => {
  const p = priceWithMods(r, mods);
  assert.notEqual(typeof p, 'string', String(p));
  return p as Exclude<typeof p, string>;
};

describe('[Epic 11 review] PF1e item pricing', () => {
  const arrow = rec({ name: 'Arrow', types: ['Ammunition', 'Arrow'], cost: 0.05, weight: 0.15 });
  const arrows20 = rec({ name: '20 Arrows', types: ['Ammunition', 'Arrow', 'Stack'], cost: 1, weight: 3, baseQty: 20 });

  test('magic ammunition: +N costs 40 × N² per piece (not 2,000 × N²)', () => {
    // +1 arrow: 0.05 + 6 (masterwork) + 40 = 46.05 gp
    assert.equal(priced(arrow, { masterwork: false, material: 'none', enhancement: 1 }).cost, 46.05);
    // +2 arrow: 0.05 + 6 + 160
    assert.equal(priced(arrow, { masterwork: false, material: 'none', enhancement: 2 }).cost, 166.05);
  });

  test('stack records (BASEQTY 20) pay per-piece ammunition mods for every piece', () => {
    assert.equal(priced(arrows20, { masterwork: true, material: 'none', enhancement: 0 }).cost, 1 + 20 * 6);
    assert.equal(priced(arrows20, { masterwork: false, material: 'none', enhancement: 1 }).cost, 1 + 20 * 6 + 20 * 40);
    assert.equal(priced(arrows20, { masterwork: false, material: 'adamantine', enhancement: 0 }).cost, 1 + 20 * 60);
    assert.equal(priced(arrows20, { masterwork: false, material: 'alchemicalSilver', enhancement: 0 }).cost, 1 + 20 * 2);
  });

  test('cold iron enhancement surcharge: 2,000 gp on weapons, 40 gp per piece of ammunition', () => {
    const longsword = rec({ name: 'Longsword', types: ['Weapon', 'Melee', 'Martial'], cost: 15, weight: 4, damage: '1d8', wield: 'OneHanded' });
    // 15 + 15 (cold iron doubles) + 2000 (surcharge) + 300 (masterwork) + 2000 (+1)
    assert.equal(priced(longsword, { masterwork: false, material: 'coldIron', enhancement: 1 }).cost, 4330);
    // 0.05 + 0.05 + 40 + 6 + 40
    assert.equal(priced(arrow, { masterwork: false, material: 'coldIron', enhancement: 1 }).cost, 86.1);
  });

  test('darkwood adds 10 gp/lb on top of the masterwork cost', () => {
    const quarterstaff = rec({ name: 'Quarterstaff', types: ['Weapon', 'Melee', 'Simple', 'TwoHanded'], cost: 0, weight: 4, damage: '1d6', wield: 'TwoHanded' });
    const heavyWooden = rec({ name: 'Heavy Wooden Shield', types: ['Shield', 'Heavy'], cost: 7, weight: 10, acBonus: 2, acp: -2, asf: 15 });
    assert.equal(priced(quarterstaff, { masterwork: false, material: 'darkwood', enhancement: 0 }).cost, 0 + 300 + 40);
    const shield = priced(heavyWooden, { masterwork: false, material: 'darkwood', enhancement: 0 });
    assert.equal(shield.cost, 7 + 150 + 100); // Core Rulebook darkwood heavy shield: 257 gp
    assert.equal(shield.weight, 5);
  });

  test('COST:0 magic items have an unknown price: never 0 gp, never bought for free', () => {
    const amulet = rec({ name: 'Amulet of Mighty Fists', types: ['Magic', 'Wondrous', 'Neck'], cost: 0, weight: 0 });
    assert.equal(baseCost(amulet), null);
    assert.match(String(priceWithMods(amulet)), /no price/);
    assert.equal(typeof itemFromRecord(amulet, 'i1'), 'string', 'buying path refuses unpriced items');
    const free = itemFromRecord(amulet, 'i1', NO_MODS, 1, { allowUnpriced: true });
    assert.notEqual(typeof free, 'string', '"Add free" may still add it');
    assert.equal((free as { value: number }).value, 0);
    // Mundane zero-cost gear stays free.
    assert.equal(baseCost(rec({ name: 'Club', types: ['Weapon', 'Simple'], cost: 0 })), 0);
    // Spell items derive from the spell (potion 50 × SL × CL, 0-level counts ½).
    assert.equal(baseCost(rec({ name: 'Potion of CLW', types: ['Magic', 'Potion'], cost: 0, spellEffect: { name: 'Cure Light Wounds', level: 1, cl: 1 } })), 50);
    assert.equal(baseCost(rec({ name: 'Wand of Light', types: ['Magic', 'Wand'], cost: 0, spellEffect: { name: 'Light', level: 0, cl: 1 } })), 375);
  });
});
