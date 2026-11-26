import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BUFF_PRESETS,
  characterEffects,
  characterSpellcasting,
  computeCharacterStats,
  computeSkills,
  describeEffects,
  effectiveConditions,
  lookupPreset,
  presetBuff,
  presetsFor,
  sumModifiers,
  tempBonusSuggestions,
  type Buff,
  type BuffEffect,
  type Character,
  type PresetContext,
} from '@vtt/shared';
import { casterPcg, makePcgCharacter, SAMPLE_PCG, withPcgLines } from '../helpers/harness';

const NO_MOD: PresetContext = { mod: () => 0 };
let n = 0;
const buff = (name: string, effects: BuffEffect[], extra: Partial<Buff> = {}): Buff => ({ id: `b${++n}`, presetId: null, name, effects, note: '', active: true, roundsLeft: null, ...extra });
const preset = (c: Character, id: string, option?: string, mod = NO_MOD) => presetBuff(c, lookupPreset(id)!, option, mod, `p${++n}`);
const stats = (c: Character) => computeCharacterStats(c);
const sword = (c: Character) => stats(c).attacks.find((a) => a.mode === 'melee')!;
const withClass = (cls: string, level: number, stats?: Parameters<typeof casterPcg>[0]['stats']) => makePcgCharacter(casterPcg({ classes: [`CLASS:${cls}|LEVEL:${level}|SKILLPOOL:0`], stats }));

describe('[Epic 8] bonus stacking', () => {
  test('same-type bonuses: only the highest counts; different types, dodge and untyped add up; penalties stack', () => {
    const line = sumModifiers([
      { value: 1, type: 'morale', source: 'Bless' },
      { value: 2, type: 'morale', source: 'Heroism' },
      { value: 1, type: 'luck', source: 'Prayer' },
      { value: 1, type: 'dodge', source: 'Haste' },
      { value: 1, type: 'dodge', source: 'Dodge' },
      { value: 2, type: 'untyped', source: 'Flanking' },
      { value: -2, type: 'untyped', source: 'Shaken' },
      { value: -2, type: 'untyped', source: 'Sickened' },
    ]);
    assert.equal(line.total, 2 + 1 + 1 + 1 + 2 - 2 - 2);
    assert.equal(line.parts.find((p) => p.source === 'Bless')!.applied, false);
  });

  test('buffs on the sheet follow the stacking rules (Bless + Heroism = +2 morale, + Prayer luck)', () => {
    const c = makePcgCharacter();
    const base = sword(c).attack.total;
    c.runtime.buffs = [preset(c, 'bless'), preset(c, 'heroism'), preset(c, 'prayer')];
    const a = sword(c).attack;
    assert.equal(a.total, base + 2 + 1);
    assert.equal(a.parts.find((p) => p.source === 'Bless')!.applied, false, 'shown in the breakdown as not stacking');
    assert.equal(sword(c).damage.total, sword(makePcgCharacter()).damage.total + 1, 'Prayer luck to damage');
  });

  test('inactive buffs do nothing', () => {
    const c = makePcgCharacter();
    c.runtime.buffs = [{ ...preset(c, 'heroism'), active: false }];
    assert.equal(sword(c).attack.total, sword(makePcgCharacter()).attack.total);
    assert.deepEqual(stats(c).effects.sources, []);
  });
});

describe('[Epic 8] buff presets in the engine', () => {
  test("Bull's Strength raises the Str score: attack, damage, CMB, CMD, carrying capacity", () => {
    const c = makePcgCharacter();
    const before = stats(c);
    c.runtime.buffs = [preset(c, 'bullsStrength')];
    const after = stats(c);
    assert.equal(after.abilities.STR.score, before.abilities.STR.score + 4);
    assert.equal(after.abilities.STR.mod, before.abilities.STR.mod + 2);
    assert.equal(after.attacks[0]!.attack.total, before.attacks[0]!.attack.total + 2);
    assert.equal(after.cmb.total, before.cmb.total + 2);
    assert.equal(after.cmd.total, before.cmd.total + 2);
    assert.ok(after.load.capacity.heavy > before.load.capacity.heavy);
    // Two enhancement bonuses to the same score don't stack.
    c.runtime.buffs.push(buff('Belt', [{ target: 'STR', value: 2, type: 'enhancement' }]));
    assert.equal(stats(c).abilities.STR.score, before.abilities.STR.score + 4);
  });

  test('Rage scales with barbarian level and lowers AC and CMD', () => {
    const b1 = withClass('Barbarian', 1, { STR: 16, CON: 14 });
    const base = stats(b1);
    b1.runtime.buffs = [preset(b1, 'rage')];
    const r = stats(b1);
    assert.equal(r.abilities.STR.score, base.abilities.STR.score + 4);
    assert.equal(r.saves.will.total, base.saves.will.total + 2);
    assert.equal(r.ac.normal.total, base.ac.normal.total - 2);
    assert.equal(r.cmd.total, base.cmd.total + 2 - 2, 'Str +2 to CMD, AC penalty −2 to CMD');
    assert.ok(r.hp.total > base.hp.total, 'Con raises hit points');
    const b11 = withClass('Barbarian', 11);
    assert.deepEqual(preset(b11, 'rage').effects.filter((x) => x.target === 'STR' || x.target === 'will').map((x) => x.value), [6, 3]);
    assert.deepEqual(preset(withClass('Barbarian', 20), 'rage').effects[0]!.value, 8);
  });

  test('Enlarge Person: one size larger (size modifiers, special size, damage dice) with +2 Str / −2 Dex size bonuses', () => {
    const c = makePcgCharacter();
    const before = stats(c);
    c.runtime.buffs = [preset(c, 'enlargePerson')];
    const after = stats(c);
    assert.equal(after.size, 'Large');
    assert.equal(after.abilities.STR.score, before.abilities.STR.score + 2);
    assert.equal(after.abilities.DEX.score, before.abilities.DEX.score - 2);
    assert.equal(sword(c).dice, '2d6', 'longsword 1d8 sized up');
    // Attack: −1 size, Str +1 mod.
    assert.equal(after.attacks[0]!.attack.total, before.attacks[0]!.attack.total - 1 + (after.abilities.STR.mod - before.abilities.STR.mod));
    assert.equal(after.cmb.total - before.cmb.total, 1 + (after.abilities.STR.mod - before.abilities.STR.mod));
    // Reduce + enlarge cancel out; size never goes past Colossal.
    c.runtime.buffs.push(preset(c, 'reducePerson'));
    assert.equal(stats(c).size, 'Medium');
    c.runtime.buffs = Array.from({ length: 6 }, () => preset(c, 'enlargePerson'));
    assert.equal(stats(c).size, 'Colossal');
  });

  test('Haste: +1 attack, +1 dodge AC (touch too), +1 Ref, +30 ft., one extra attack on a full attack', () => {
    const c = makePcgCharacter();
    const before = stats(c);
    c.runtime.buffs = [preset(c, 'haste')];
    const after = stats(c);
    const a = after.attacks[0]!;
    assert.equal(a.attack.total, before.attacks[0]!.attack.total + 1);
    assert.equal(a.fullAttack.length, before.attacks[0]!.fullAttack.length + 1);
    assert.equal(a.fullAttack[0], a.fullAttack[1]);
    assert.equal(after.ac.normal.total, before.ac.normal.total + 1);
    assert.equal(after.ac.touch.total, before.ac.touch.total + 1);
    assert.equal(after.ac.flatFooted.total, before.ac.flatFooted.total, 'no dodge bonus when flat-footed');
    assert.equal(after.saves.ref.total, before.saves.ref.total + 1);
    assert.equal(after.speed.total, before.speed.total + 30);
    assert.equal(after.cmd.total, before.cmd.total + 1, 'dodge bonuses raise CMD');
    // A second haste adds no second extra attack.
    c.runtime.buffs.push(preset(c, 'haste'));
    assert.equal(stats(c).attacks[0]!.fullAttack.length, a.fullAttack.length);
  });

  test('Mage Armor is an armor bonus: not on touch AC, not stacking with worn armor', () => {
    const c = makePcgCharacter();
    const before = stats(c);
    c.runtime.buffs = [preset(c, 'mageArmor')];
    const after = stats(c);
    assert.equal(after.ac.touch.total, before.ac.touch.total);
    const armorBefore = before.ac.normal.parts.filter((p) => p.type === 'armor' && p.applied).reduce((s, p) => s + p.value, 0);
    assert.equal(after.ac.normal.total - before.ac.normal.total, Math.max(0, 4 - armorBefore));
    assert.equal(after.cmd.total, before.cmd.total, 'armor bonuses don’t raise CMD');
  });

  test('presets scale with options and class levels; class abilities are only offered to their class', () => {
    const bard5 = withClass('Bard', 5);
    assert.equal(lookupPreset('inspireCourage')!.option!.initial(bard5), '2');
    assert.deepEqual(preset(bard5, 'inspireCourage').effects, [
      { target: 'attack', value: 2, type: 'competence' },
      { target: 'damage', value: 2, type: 'competence' },
    ]);
    const alch = withClass('Alchemist', 1);
    assert.deepEqual(preset(alch, 'mutagen', 'DEX').effects.map((x) => [x.target, x.value]), [
      ['DEX', 4],
      ['WIS', -2],
      ['ac', 2],
    ]);
    const inq = withClass('Inquisitor', 6);
    assert.deepEqual(preset(inq, 'judgment', 'destruction').effects, [{ target: 'damage', value: 3, type: 'sacred' }]);
    assert.deepEqual(preset(inq, 'judgment', 'protection').effects, [{ target: 'ac', value: 2, type: 'sacred' }]);
    const pal = withClass('Paladin', 4, { CHA: 16 });
    const smite = preset(pal, 'smiteEvil', undefined, { mod: (k) => (k === 'CHA' ? 3 : 0) });
    assert.deepEqual(smite.effects, [
      { target: 'attack', value: 3, type: 'untyped' },
      { target: 'damage', value: 4, type: 'untyped' },
      { target: 'ac', value: 3, type: 'deflection' },
    ]);
    assert.ok(presetsFor(pal).some((p) => p.id === 'smiteEvil'));
    assert.ok(!presetsFor(inq).some((p) => p.id === 'smiteEvil' || p.id === 'rage'));
    assert.ok(presetsFor(inq).some((p) => p.id === 'bless'), 'spells are for everyone');
    assert.equal(preset(withClass('Slayer', 10), 'studiedTarget').effects[0]!.value, 3);
    assert.equal(preset(withClass('Magus', 9), 'arcanePool').effects[0]!.value, 3);
    assert.equal(new Set(BUFF_PRESETS.map((p) => p.id)).size, BUFF_PRESETS.length, 'preset ids are unique');
  });

  test('caster level buffs raise caster level and concentration', () => {
    const w = makePcgCharacter(casterPcg({ classes: ['CLASS:Wizard|LEVEL:5|SKILLPOOL:0'], stats: { INT: 16 } }));
    const base = characterSpellcasting(w)[0]!;
    w.runtime.buffs = [buff('Orange Prism Ioun Stone', [{ target: 'casterLevel', value: 1, type: 'untyped' }])];
    const after = characterSpellcasting(w)[0]!;
    assert.equal(after.casterLevel, base.casterLevel + 1);
    assert.equal(after.concentration, base.concentration + 1);
  });

  test('describeEffects and PCGen TEMPBONUS suggestions', () => {
    assert.equal(describeEffects(lookupPreset('haste')!.effects(makePcgCharacter(), '', NO_MOD)), '+1 attack, +1 dodge AC, +1 dodge Ref, +30 enhancement ft. speed, +1 attack on full attacks');
    const c = makePcgCharacter(withPcgLines(SAMPLE_PCG, 'TEMPBONUS:SPELL=Bless|TBTARGET:PC', 'TEMPBONUS:SPELL=Divine Power|TBTARGET:PC', 'TEMPBONUS:SPELL=Bless|TBTARGET:PC'));
    const s = tempBonusSuggestions(c);
    // The fixture's own TEMPBONUS is Power Attack: a combat toggle, so not suggested as a buff.
    assert.deepEqual(s.map((x) => [x.name, x.preset?.id ?? null]), [
      ['Bless', 'bless'],
      ['Divine Power', null],
    ]);
  });
});

describe('[Epic 8] condition mechanics', () => {
  const withConditions = (...names: string[]) => {
    const c = makePcgCharacter();
    c.runtime.conditions = names;
    return c;
  };
  const base = stats(makePcgCharacter());

  test('fear and fatigue don’t stack within their group (worst applies); implied conditions are added', () => {
    assert.deepEqual(effectiveConditions(['Shaken', 'Frightened']).sort(), ['frightened']);
    assert.deepEqual(effectiveConditions(['Fatigued', 'Exhausted']), ['exhausted']);
    assert.deepEqual(effectiveConditions(['Paralyzed']).sort(), ['helpless', 'paralyzed']);
    const s = stats(withConditions('Shaken', 'Frightened'));
    assert.equal(s.attacks[0]!.attack.total, base.attacks[0]!.attack.total - 2);
    const ex = stats(withConditions('Fatigued', 'Exhausted'));
    assert.equal(ex.abilities.STR.score, base.abilities.STR.score - 6);
  });

  test('shaken and sickened are different conditions, so their penalties stack', () => {
    const s = stats(withConditions('Shaken', 'Sickened'));
    assert.equal(s.attacks[0]!.attack.total, base.attacks[0]!.attack.total - 4);
    assert.equal(s.saves.will.total, base.saves.will.total - 4);
    assert.equal(s.attacks[0]!.damage.total, base.attacks[0]!.damage.total - 2, 'only sickened hurts damage');
    assert.equal(s.cmb.total, base.cmb.total - 4, 'attack penalties apply to combat maneuvers');
    const c = withConditions('Shaken', 'Sickened');
    const acro = computeSkills(c, stats(c)).rows.find((r) => r.name === 'Acrobatics')!;
    const acroBase = computeSkills(makePcgCharacter(), base).rows.find((r) => r.name === 'Acrobatics')!;
    assert.equal(acro.total.total, acroBase.total.total - 4);
  });

  test('losing the Dex bonus to AC: flat-footed, blinded, stunned (and dodge bonuses go too)', () => {
    const c = withConditions('Flat-footed');
    c.runtime.buffs = [preset(c, 'haste')];
    const ff = stats(c);
    assert.equal(ff.effects.loseDexToAc, true);
    assert.equal(ff.ac.normal.total, base.ac.flatFooted.total, 'normal AC = flat-footed AC');
    assert.equal(ff.cmd.total, base.cmd.total - Math.max(0, base.abilities.DEX.mod), 'no Dex or dodge to CMD');
    const blind = stats(withConditions('Blinded'));
    assert.equal(blind.ac.normal.total, base.ac.flatFooted.total - 2);
    assert.ok(blind.effects.notes.some((x) => /50% miss chance/.test(x)));
  });

  test('helpless: Dex counts as 0; paralyzed: Str too', () => {
    const h = stats(withConditions('Unconscious'));
    assert.equal(h.abilities.DEX.score, 0);
    assert.equal(h.abilities.DEX.mod, -5);
    assert.equal(h.abilities.STR.score, base.abilities.STR.score);
    const p = stats(withConditions('Paralyzed'));
    assert.equal(p.abilities.STR.score, 0);
  });

  test('prone, grappled, entangled, dazzled, deafened', () => {
    const prone = stats(withConditions('Prone'));
    assert.equal(prone.attacks[0]!.attack.total, base.attacks[0]!.attack.total - 4);
    const grap = stats(withConditions('Grappled'));
    assert.equal(grap.abilities.DEX.score, base.abilities.DEX.score - 4);
    assert.equal(grap.cmb.total, base.cmb.total - 4, '−2 attack and −2 CMB');
    const ent = stats(withConditions('Entangled'));
    assert.equal(ent.attacks[0]!.attack.total, base.attacks[0]!.attack.total - 2);
    assert.equal(stats(withConditions('Dazzled')).attacks[0]!.attack.total, base.attacks[0]!.attack.total - 1);
    assert.equal(stats(withConditions('Deafened')).initiative.total, base.initiative.total - 4);
  });

  test('marker conditions that name a buff apply it once, never on top of the same active buff', () => {
    const c = withConditions('Hasted', 'Blessed', 'Concentrating');
    const s = stats(c);
    assert.equal(s.attacks[0]!.attack.total, base.attacks[0]!.attack.total + 1 + 1);
    assert.deepEqual(s.effects.sources.map((x) => x.name).sort(), ['Blessed', 'Hasted'], 'cosmetic markers are ignored');
    c.runtime.buffs = [preset(c, 'haste')];
    assert.equal(stats(c).attacks[0]!.attack.total, base.attacks[0]!.attack.total + 1 + 1, 'Hasted marker + Haste buff = one haste');
    assert.equal(characterEffects(c).sources.filter((x) => /hast/i.test(x.name)).length, 1);
  });
});
