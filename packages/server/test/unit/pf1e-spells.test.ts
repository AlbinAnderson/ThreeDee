import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  bonusSpells,
  characterSpellcasting,
  checkPrepared,
  conversionSpell,
  lookupCasterClass,
  lookupSpell,
  metamagicAdjust,
  planCast,
  spellCard,
  spellDc,
  spellDcLevel,
  spellSlotKey,
  type CastPlan,
  type Character,
} from '@vtt/shared';
import { casterPcg, makePcgCharacter, spellLine } from '../helpers/harness';

const caster = (opts: Parameters<typeof casterPcg>[0]) => makePcgCharacter(casterPcg(opts));
const info = (c: Character, cls: string) => characterSpellcasting(c).find((i) => i.className === cls)!;
const level = (c: Character, cls: string, l: number) => info(c, cls).levels.find((x) => x.level === l);
const plan = (p: CastPlan | string): CastPlan => {
  if (typeof p === 'string') throw new Error(p);
  return p;
};

describe('[Epic 7] spellcasting math', () => {
  test('bonus spells per day follow Core Rulebook Table 1-3', () => {
    assert.equal(bonusSpells(0, 1), 0);
    assert.deepEqual([1, 2, 3, 4].map((l) => bonusSpells(3, l)), [1, 1, 1, 0]);
    assert.deepEqual([1, 2, 5].map((l) => bonusSpells(5, l)), [2, 1, 1]);
    assert.equal(bonusSpells(9, 1), 3);
    assert.equal(bonusSpells(5, 0), 0, 'no bonus cantrips');
  });

  test('specialist wizard: base + bonus slots, school slot, CL, concentration and DCs', () => {
    const c = caster({ classes: ['CLASS:Wizard|SUBCLASS:Evoker|LEVEL:5|SKILLPOOL:0'], stats: { INT: 18 } });
    const w = info(c, 'Wizard');
    assert.equal(w.model, 'prepared');
    assert.equal(w.stat, 'INT');
    assert.equal(w.casterLevel, 5);
    assert.equal(w.concentration, 5 + 4);
    assert.equal(w.dcBase, 14);
    assert.equal(w.bonusSlot, 'school');
    assert.equal(w.maxLevel, 3);
    // Wizard 5: 4/3/2/1 base; Int 18 adds 1/1/1.
    assert.deepEqual(
      w.levels.map((l) => [l.level, l.perDay, l.extra, l.atWill]),
      [
        [0, 4, 0, true],
        [1, 4, 1, false],
        [2, 3, 1, false],
        [3, 2, 1, false],
      ],
    );
    const universalist = caster({ classes: ['CLASS:Wizard|SUBCLASS:Universalist|LEVEL:5|SKILLPOOL:0'], stats: { INT: 18 } });
    assert.equal(info(universalist, 'Wizard').bonusSlot, null);
  });

  test('spontaneous casters: slots per level, cantrips at will, no prepared list', () => {
    const c = caster({ classes: ['CLASS:Sorcerer|LEVEL:3|SKILLPOOL:0'], stats: { CHA: 16 } });
    const s = info(c, 'Sorcerer');
    assert.equal(s.model, 'spontaneous');
    assert.deepEqual(s.levels.map((l) => [l.level, l.perDay, l.atWill]), [
      [0, 0, true],
      [1, 6, false],
    ]);
    assert.deepEqual(s.prepared, []);
    assert.equal(s.conversions.length, 0);
  });

  test('half casters: paladins cast at level − 3 and get only bonus spells at 4th; none before', () => {
    const p4 = caster({ classes: ['CLASS:Paladin|LEVEL:4|SKILLPOOL:0'], stats: { CHA: 14 } });
    const p = info(p4, 'Paladin');
    assert.equal(p.casterLevel, 1);
    assert.deepEqual(p.levels.map((l) => [l.level, l.base, l.perDay]), [[1, 0, 1]]);
    const p3 = caster({ classes: ['CLASS:Paladin|LEVEL:3|SKILLPOOL:0'], stats: { CHA: 14 } });
    assert.equal(info(p3, 'Paladin').maxLevel, -1);
    assert.equal(info(p3, 'Paladin').levels.length, 0);
  });

  test('a casting score below 10 + spell level blocks that level', () => {
    const c = caster({ classes: ['CLASS:Wizard|LEVEL:3|SKILLPOOL:0'], stats: { INT: 11 } });
    assert.equal(level(c, 'Wizard', 1)!.castable, true);
    assert.equal(level(c, 'Wizard', 2)!.castable, false);
    assert.equal(level(c, 'Wizard', 2)!.perDay, 0);
    assert.equal(info(c, 'Wizard').maxLevel, 1);
    assert.ok(info(c, 'Wizard').warnings.some((w) => /too low/.test(w)));
  });

  test('cleric and druid: domain slots and spontaneous conversion by alignment', () => {
    const cleric = (align: string) => info(caster({ classes: ['CLASS:Cleric|LEVEL:1|SKILLPOOL:0'], stats: { WIS: 14 }, align }), 'Cleric');
    assert.deepEqual(cleric('NG').conversions, ['cure']);
    assert.deepEqual(cleric('CE').conversions, ['inflict']);
    assert.deepEqual(cleric('TN').conversions, ['cure', 'inflict']);
    assert.equal(cleric('NG').bonusSlot, 'domain');

    const druid = caster({ classes: ['CLASS:Druid|LEVEL:1|SKILLPOOL:0'], stats: { WIS: 14 } });
    assert.deepEqual(info(druid, 'Druid').conversions, ['sna']);
    assert.equal(info(druid, 'Druid').bonusSlot, null, 'no domain without nature bond');
    const domainDruid = caster({ classes: ['CLASS:Druid|LEVEL:1|SKILLPOOL:0'], stats: { WIS: 14 }, extra: ['DOMAIN:Air|SOURCE:[TYPE:CLASS|NAME:Druid]'] });
    assert.equal(info(domainDruid, 'Druid').bonusSlot, 'domain');

    assert.deepEqual(conversionSpell('cure', 2), ['Cure Moderate Wounds', 2]);
    assert.deepEqual(conversionSpell('inflict', 9), ['Mass Inflict Critical Wounds', 8], '9th converts to the highest lower cure/inflict');
    assert.deepEqual(conversionSpell('sna', 3), ["Summon Nature's Ally III", 3]);
    assert.equal(conversionSpell('cure', 0), null);
  });

  test('metamagic: slot adjustments, DCs use the spell’s own level except Heighten', () => {
    assert.equal(metamagicAdjust('Empower Spell'), 2);
    assert.equal(metamagicAdjust('Quicken Spell'), 4);
    assert.equal(metamagicAdjust('Heighten Spell'), undefined);
    const c = caster({
      classes: ['CLASS:Wizard|LEVEL:7|SKILLPOOL:0'],
      stats: { INT: 18 },
      spells: [spellLine('Magic Missile', 'Wizard', 1)],
      extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Empower Spell|TYPE:Metamagic'],
    });
    const w = info(c, 'Wizard');
    assert.equal(spellDcLevel(w, 'Magic Missile', 3, ['Empower Spell']), 1);
    assert.equal(spellDcLevel(w, 'Magic Missile', 3, ['Heighten Spell']), 3);
    assert.equal(spellDcLevel(w, 'Unknown Spell', 3, ['Empower Spell']), 1, 'not in the book: slot minus metamagic');
    assert.deepEqual(w.metamagic, ['Empower Spell']);
  });

  test('Spell Focus raises DCs of its school only', () => {
    const c = caster({
      classes: ['CLASS:Wizard|LEVEL:5|SKILLPOOL:0'],
      stats: { INT: 16 },
      extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Spell Focus|TYPE:General|APPLIEDTO:Evocation', 'FEAT:Greater Spell Focus (Evocation)'],
    });
    const w = info(c, 'Wizard');
    assert.equal(spellDc(c, w, 'Fireball', 3), 10 + 3 + 3 + 2);
    assert.equal(spellDc(c, w, 'Color Spray', 1), 10 + 1 + 3);
  });

  test('spell reference data: school, save, SR and area', () => {
    const fb = lookupSpell('fireball')!;
    assert.equal(fb.save, 'Reflex half');
    assert.deepEqual(fb.area, { kind: 'circle', feet: 20, label: '20-ft.-radius spread' });
    assert.deepEqual(lookupSpell('Burning Hands')!.area?.kind, 'cone');
    assert.deepEqual(lookupSpell('Lightning Bolt')!.area, { kind: 'line', feet: 120, label: '120-ft. line' });
    assert.equal(lookupSpell("Summon Nature's Ally IV")!.sr, 'no');
    assert.equal(lookupSpell('Not A Real Spell'), undefined);
    assert.equal(lookupCasterClass('Summoner (Unchained)')?.model, 'spontaneous');
    assert.equal(lookupCasterClass('Fighter'), undefined);
  });
});

describe('[Epic 7] casting and preparing rules', () => {
  const sorcerer = () =>
    caster({
      classes: ['CLASS:Sorcerer|LEVEL:3|SKILLPOOL:0'],
      stats: { CHA: 16 },
      spells: [spellLine('Burning Hands', 'Sorcerer', 1), spellLine('Ray of Frost', 'Sorcerer', 0), spellLine('Magic Missile', 'Sorcerer', 1)],
      extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Still Spell|TYPE:Metamagic', 'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Widen Spell|TYPE:Metamagic'],
    });

  test('spontaneous casts spend a slot of the (metamagic-raised) level; cantrips are free', () => {
    const c = sorcerer();
    const p = plan(planCast(c, { className: 'Sorcerer', spellName: 'Burning Hands', level: 1 }));
    assert.equal(p.slotKey, spellSlotKey('Sorcerer', 1));
    assert.equal(p.dcLevel, 1);
    const cantrip = plan(planCast(c, { className: 'Sorcerer', spellName: 'Ray of Frost', level: 0 }));
    assert.equal(cantrip.slotKey, null);
    assert.match(planCast(c, { className: 'Sorcerer', spellName: 'Burning Hands', level: 1, metamagic: ['Still Spell'] }) as string, /can't cast 2nd/);
    assert.match(planCast(c, { className: 'Sorcerer', spellName: 'Burning Hands', level: 1, metamagic: ['Empower Spell'] }) as string, /don't have/);
    assert.match(planCast(c, { className: 'Sorcerer', spellName: 'Fireball', level: 3 }) as string, /isn't a 3rd-level spell you know/);
    c.runtime.uses[spellSlotKey('Sorcerer', 1)] = 6;
    assert.match(planCast(c, { className: 'Sorcerer', spellName: 'Magic Missile', level: 1 }) as string, /No 1st-level slots left/);
    assert.match(planCast(c, { className: 'Wizard', spellName: 'Magic Missile', level: 1 }) as string, /can't cast Wizard spells/);
    assert.match(planCast(c, { className: 'Sorcerer', preparedId: 'x' }) as string, /spontaneously/);
  });

  test('spell cards: DC, area (widened), SR roll only when SR applies', () => {
    const c = caster({
      classes: ['CLASS:Sorcerer|LEVEL:8|SKILLPOOL:0'],
      stats: { CHA: 18 },
      spells: [spellLine('Burning Hands', 'Sorcerer', 1), spellLine('Grease', 'Sorcerer', 1)],
      extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Widen Spell|TYPE:Metamagic', 'FEAT:Spell Penetration'],
    });
    const bh = spellCard(c, plan(planCast(c, { className: 'Sorcerer', spellName: 'Burning Hands', level: 1 })));
    assert.equal(bh.title, `${c.name}: Burning Hands`);
    assert.match(bh.subtitle, /Sorcerer 1st · CL 8 · DC 15/);
    assert.match(bh.text, /Reflex half \(DC 15\)/);
    assert.deepEqual(bh.area, { kind: 'cone', feet: 15, label: '15-ft. cone' });
    assert.deepEqual(bh.rolls, [
      { label: 'Concentration', bonus: 8 + 4 },
      { label: 'Caster level vs. SR', bonus: 8 + 2 },
    ]);
    const wide = spellCard(c, plan(planCast(c, { className: 'Sorcerer', spellName: 'Burning Hands', level: 1, metamagic: ['Widen Spell'] })));
    assert.equal(wide.area?.feet, 30);
    assert.match(wide.subtitle, /4th slot \(1st-level spell\)/);
    const grease = spellCard(c, plan(planCast(c, { className: 'Sorcerer', spellName: 'Grease', level: 1 })));
    assert.deepEqual(grease.rolls.map((r) => r.label), ['Concentration'], 'Grease ignores SR');
    assert.equal(grease.area?.kind, 'square');
  });

  test('prepared casters use the .pcg prepared book until they prepare in the VTT', () => {
    const c = caster({
      classes: ['CLASS:Wizard|SUBCLASS:Evoker|LEVEL:3|SKILLPOOL:0'],
      stats: { INT: 16 },
      spells: [
        spellLine('Magic Missile', 'Wizard', 1),
        spellLine('Shield', 'Wizard', 1),
        spellLine('Detect Magic', 'Wizard', 0),
        spellLine('Magic Missile', 'Wizard', 1, 'Prepared Spells', 2),
        spellLine('Detect Magic', 'Wizard', 0, 'Prepared Spells'),
      ],
    });
    const w = info(c, 'Wizard');
    assert.equal(w.preparedFromFile, true);
    assert.deepEqual(w.prepared.map((p) => [p.id, p.name, p.level]), [
      ['pcg-0', 'Magic Missile', 1],
      ['pcg-1', 'Magic Missile', 1],
      ['pcg-2', 'Detect Magic', 0],
    ]);
    const mm = plan(planCast(c, { className: 'Wizard', preparedId: 'pcg-0' }));
    assert.equal(mm.markCast, true);
    assert.equal(plan(planCast(c, { className: 'Wizard', preparedId: 'pcg-2' })).markCast, false, 'cantrips stay prepared');
    c.runtime.prepared.Wizard = w.prepared.map((p) => (p.id === 'pcg-0' ? { ...p, cast: true } : p));
    assert.match(planCast(c, { className: 'Wizard', preparedId: 'pcg-0' }) as string, /already cast/);
    assert.match(planCast(c, { className: 'Wizard', spellName: 'Shield', level: 1 }) as string, /prepared spells/);
  });

  test('conversion: a prepared spell becomes cure/inflict/SNA, but not a domain slot spell', () => {
    const c = caster({ classes: ['CLASS:Cleric|LEVEL:3|SKILLPOOL:0'], stats: { WIS: 16 }, align: 'NG' });
    c.runtime.prepared.Cleric = [
      { id: 'b', name: 'Bless', level: 1, metamagic: [], slot: 'normal', cast: false },
      { id: 'd', name: 'Protection from Evil', level: 1, metamagic: [], slot: 'bonus', cast: false },
    ];
    const cure = plan(planCast(c, { className: 'Cleric', preparedId: 'b', convert: 'cure' }));
    assert.equal(cure.spellName, 'Cure Light Wounds');
    assert.equal(cure.convertedFrom, 'Bless');
    assert.match(spellCard(c, cure).text, /in place of Bless/);
    assert.match(planCast(c, { className: 'Cleric', preparedId: 'd', convert: 'cure' }) as string, /Domain slot/);
    assert.match(planCast(c, { className: 'Cleric', preparedId: 'b', convert: 'inflict' }) as string, /can't convert/);
  });

  test('preparing: slot counts, the domain slot, spellbook and metamagic levels', () => {
    const wiz = caster({
      classes: ['CLASS:Wizard|SUBCLASS:Evoker|LEVEL:5|SKILLPOOL:0'],
      stats: { INT: 16 },
      spells: [spellLine('Magic Missile', 'Wizard', 1), spellLine('Fireball', 'Wizard', 3), spellLine('Shield', 'Wizard', 1)],
      extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Empower Spell|TYPE:Metamagic'],
    });
    const e = (id: string, name: string, lvl: number, slot: 'normal' | 'bonus' = 'normal', metamagic: string[] = []) => ({ id, name, level: lvl, metamagic, slot });
    // Wizard 5, Int 16: 1st = 3 + 1 bonus = 4 normal slots, plus a school slot.
    const ok = [e('1', 'Magic Missile', 1), e('2', 'Magic Missile', 1), e('3', 'Shield', 1), e('4', 'Shield', 1), e('5', 'Magic Missile', 1, 'bonus'), e('6', 'Magic Missile', 3, 'normal', ['Empower Spell'])];
    assert.equal(checkPrepared(wiz, 'Wizard', ok), true);
    assert.match(checkPrepared(wiz, 'Wizard', [...ok, e('7', 'Shield', 1)]) as string, /Too many 1st-level/);
    assert.match(checkPrepared(wiz, 'Wizard', [...ok, e('7', 'Shield', 1, 'bonus')]) as string, /Only 1 school slot/);
    assert.match(checkPrepared(wiz, 'Wizard', [e('1', 'Haste', 3)]) as string, /isn't in your spellbook/);
    assert.match(checkPrepared(wiz, 'Wizard', [e('1', 'Magic Missile', 2, 'normal', ['Empower Spell'])]) as string, /3rd-level slot/);
    assert.match(checkPrepared(wiz, 'Wizard', [e('1', 'Magic Missile', 3, 'normal', ['Quicken Spell'])]) as string, /don't have Quicken/);
    assert.match(checkPrepared(wiz, 'Wizard', [e('1', 'Fireball', 4)]) as string, /can't prepare 4th-level/);
    assert.match(checkPrepared(wiz, 'Wizard', [e('1', 'Shield', 1), e('1', 'Shield', 1)]) as string, /Duplicate/);
    assert.match(checkPrepared(wiz, 'Wizard', [e('1', 'Shield', 0, 'bonus')]) as string, /No school slot at 0-level/);

    // Clerics prepare from the whole class list.
    const cleric = caster({ classes: ['CLASS:Cleric|LEVEL:1|SKILLPOOL:0'], stats: { WIS: 12 } });
    assert.equal(checkPrepared(cleric, 'Cleric', [e('1', 'Bless', 1), e('2', 'Shield of Faith', 1), e('3', 'Protection from Evil', 1, 'bonus')]), true);
    const sorc = caster({ classes: ['CLASS:Sorcerer|LEVEL:1|SKILLPOOL:0'], stats: { CHA: 12 } });
    assert.match(checkPrepared(sorc, 'Sorcerer', []) as string, /don't prepare/);
  });

  test('arcanist (hybrid): prepares known spells per its table, casts them with shared slots', () => {
    const c = caster({
      classes: ['CLASS:Arcanist|LEVEL:1|SKILLPOOL:0'],
      stats: { INT: 16 },
      spells: [spellLine('Magic Missile', 'Arcanist', 1), spellLine('Grease', 'Arcanist', 1), spellLine('Color Spray', 'Arcanist', 1), spellLine('Light', 'Arcanist', 0)],
      extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Silent Spell|TYPE:Metamagic'],
    });
    const a = info(c, 'Arcanist');
    assert.equal(a.model, 'hybrid');
    assert.equal(level(c, 'Arcanist', 1)!.perDay, 2 + 1);
    assert.equal(level(c, 'Arcanist', 1)!.prepareLimit, 2);
    const e = (id: string, name: string, lvl: number) => ({ id, name, level: lvl, metamagic: [] as string[], slot: 'normal' as const });
    assert.equal(checkPrepared(c, 'Arcanist', [e('1', 'Magic Missile', 1), e('2', 'Grease', 1), e('3', 'Light', 0)]), true);
    assert.match(checkPrepared(c, 'Arcanist', [e('1', 'Magic Missile', 1), e('2', 'Grease', 1), e('3', 'Color Spray', 1)]) as string, /Too many 1st-level/);
    assert.match(checkPrepared(c, 'Arcanist', [{ ...e('1', 'Magic Missile', 1), metamagic: ['Silent Spell'] }]) as string, /at least a 2nd-level slot/);
    c.runtime.prepared.Arcanist = [{ ...e('1', 'Magic Missile', 1), cast: false }];
    assert.equal(plan(planCast(c, { className: 'Arcanist', spellName: 'Magic Missile', level: 1 })).slotKey, spellSlotKey('Arcanist', 1));
    assert.match(planCast(c, { className: 'Arcanist', spellName: 'Grease', level: 1 }) as string, /isn't prepared today/);
  });

  test('classes the rules don’t know: casting settings on the sheet, else a warning', () => {
    const c = caster({ classes: ['CLASS:Mystic Theurge|LEVEL:2|SKILLPOOL:0'], spells: [spellLine('Bless', 'Mystic Theurge', 1)] });
    const before = info(c, 'Mystic Theurge');
    assert.ok(before.warnings.some((w) => /Spells per day/.test(w)));
    assert.ok(before.warnings.some((w) => /casting ability/.test(w)));
    assert.equal(before.levels.find((l) => l.level === 1), undefined);
    c.sheet.spellcasting['Mystic Theurge'] = { model: 'prepared', stat: 'WIS', casterLevel: 7, perDay: [null, 2, 1], dcBonus: 1, concentrationBonus: 2 };
    const after = info(c, 'Mystic Theurge');
    assert.equal(after.model, 'prepared');
    assert.equal(after.casterLevel, 7);
    assert.deepEqual(after.levels.map((l) => [l.level, l.base]), [
      [0, null],
      [1, 2],
      [2, 1],
    ]);
    assert.deepEqual(after.warnings.filter((w) => /per day|ability/.test(w)), []);
    assert.equal(after.dcBase, 10 + after.abilityMod + 1);
    assert.equal(after.concentration, 7 + after.abilityMod + 2);
  });
});
