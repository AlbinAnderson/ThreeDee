import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  actionCostFor,
  casterAsf,
  characterAbilities,
  characterResources,
  characterSpellcasting,
  computeCharacterStats,
  computeSkills,
  createInitialState,
  createToken,
  effectiveTurn,
  lookupPf1Action,
  lookupPreset,
  makeItem,
  pf1eTurnActions,
  planCast,
  presetBuff,
  spellCard,
  type Character,
  type PresetContext,
  type RulesProvider,
} from '@vtt/shared';
import { casterPcg, makePcgCharacter } from '../helpers/harness';

const NO_MOD: PresetContext = { mod: () => 0 };
let seq = 0;
const preset = (c: Character, id: string, option?: string) => presetBuff(c, lookupPreset(id)!, option, NO_MOD, `audit-${++seq}`);

function pcgWith(opts: Parameters<typeof casterPcg>[0] & { race?: string }): Character {
  let text = casterPcg(opts);
  if (opts.race) text = text.replace('RACE:Human', `RACE:${opts.race}`);
  return makePcgCharacter(text);
}

const CHAIN_SHIRT = () =>
  makeItem({ id: 'cs', name: 'Chain Shirt', weight: 25, armor: { kind: 'armor', category: 'light', bonus: 4, enhancement: 0, maxDex: 4, acp: -2, asf: 20 } });
const BREASTPLATE = () =>
  makeItem({ id: 'bp', name: 'Breastplate', weight: 30, armor: { kind: 'armor', category: 'medium', bonus: 6, enhancement: 0, maxDex: 3, acp: -4, asf: 25 } });
const FULL_PLATE = () =>
  makeItem({ id: 'fp', name: 'Full Plate', weight: 50, armor: { kind: 'armor', category: 'heavy', bonus: 9, enhancement: 0, maxDex: 1, acp: -6, asf: 35 } });
const HEAVY_SHIELD = () =>
  makeItem({ id: 'hs', name: 'Heavy Wooden Shield', weight: 10, armor: { kind: 'shield', category: 'shield', bonus: 2, enhancement: 0, maxDex: null, acp: -2, asf: 15 } });
const TOWER_SHIELD = () =>
  makeItem({ id: 'ts', name: 'Tower Shield', weight: 45, armor: { kind: 'shield', category: 'shield', bonus: 4, enhancement: 0, maxDex: 2, acp: -10, asf: 50 } });

describe('PF1e rules audit: Barbarian & Unchained Barbarian', () => {
  test('Fast Movement grants +10 ft before armor speed reduction and disables in heavy armor or heavy load', () => {
    // Human Barbarian 1: 30 + 10 = 40 ft unarmored; 40 -> 30 ft in medium armor (CRB p.31); 30 -> 20 ft in heavy armor.
    const human = pcgWith({ classes: ['CLASS:Barbarian|LEVEL:1|SKILLPOOL:0'], stats: { STR: 16 } });
    assert.equal(computeCharacterStats(human).speed.total, 40, 'unarmored Human Barbarian moves 40 ft');

    human.inventory.items.push(BREASTPLATE());
    human.inventory.loadouts[0]!.slots = { bp: 'armor' };
    assert.equal(computeCharacterStats(human).speed.total, 30, 'Human Barbarian in medium armor: (30 + 10) reduced to 30 ft');

    human.inventory.items = [FULL_PLATE()];
    human.inventory.loadouts[0]!.slots = { fp: 'armor' };
    assert.equal(computeCharacterStats(human).speed.total, 20, 'heavy armor disables Fast Movement: 30 -> 20 ft');

    // Heavy load also disables Fast Movement.
    human.inventory.items = [makeItem({ id: 'boulder', name: 'Boulder', weight: 170 })];
    human.inventory.loadouts[0]!.slots = {};
    assert.equal(computeCharacterStats(human).load.level, 'heavy');
    assert.equal(computeCharacterStats(human).speed.total, 20, 'heavy load disables Fast Movement: 30 -> 20 ft');

    // Gnome Barbarian (20 ft base): 20 + 10 = 30 unarmored, 30 -> 20 in medium armor.
    const gnome = pcgWith({ classes: ['CLASS:Unchained Barbarian|LEVEL:1|SKILLPOOL:0'], race: 'Gnome', stats: { STR: 14 } });
    assert.equal(computeCharacterStats(gnome).speed.total, 30);
    gnome.inventory.items.push(BREASTPLATE());
    gnome.inventory.loadouts[0]!.slots = { bp: 'armor' };
    assert.equal(computeCharacterStats(gnome).speed.total, 20);

    // Dwarf Bloodrager (20 ft steady): 20 + 10 = 30 ft unarmored AND 30 ft in medium armor.
    const dwarf = pcgWith({ classes: ['CLASS:Bloodrager|LEVEL:1|SKILLPOOL:0'], race: 'Dwarf', stats: { STR: 16 } });
    dwarf.inventory.items.push(BREASTPLATE());
    dwarf.inventory.loadouts[0]!.slots = { bp: 'armor' };
    assert.equal(computeCharacterStats(dwarf).speed.total, 30, 'Dwarf steady + Bloodrager Fast Movement in medium armor');
  });

  test('Rage rounds use permanent CON modifier (ignoring Rage / Bear’s Endurance temp CON) and add +6 per Extra Rage', () => {
    const barb = pcgWith({
      classes: ['CLASS:Barbarian|LEVEL:3|SKILLPOOL:0'],
      stats: { STR: 16, CON: 14 }, // permanent CON mod +2 => 4 + 2 + 2*(3-1) = 10 rounds
      extra: [
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Extra Rage',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Extra Rage',
      ],
    });
    const baseMax = characterResources(barb).find((r) => r.def.id === 'rage')!.max;
    assert.equal(baseMax, 10 + 12, '4 + permanent Con (+2) + 4 (lvl 3) + 2*6 Extra Rage = 22');

    // Temporary CON increases (Rage, Bear's Endurance, sheet abilityTemp) must NOT raise Rage rounds/day.
    barb.runtime.buffs = [preset(barb, 'rage'), preset(barb, 'bearsEndurance')];
    barb.runtime.abilityTemp.CON = 4;
    const stats = computeCharacterStats(barb);
    assert.ok(stats.abilities.CON.mod > stats.abilities.CON.permanentMod);
    assert.equal(characterResources(barb).find((r) => r.def.id === 'rage')!.max, 22);
  });

  test('Unchained Rage adds untyped melee/thrown damage, melee attack and Will saves, stacking with Heroism', () => {
    const attackFor = (weaponItem: ReturnType<typeof makeItem>, withBuffs: boolean) => {
      const ub = pcgWith({ classes: ['CLASS:Unchained Barbarian|LEVEL:5|SKILLPOOL:0'], stats: { STR: 16, DEX: 14, CON: 14 } });
      ub.inventory.items.push(weaponItem);
      ub.inventory.loadouts[0]!.slots = { [weaponItem.id]: 'primary' };
      if (withBuffs) ub.runtime.buffs = [preset(ub, 'unchainedRage'), preset(ub, 'heroism')];
      const s = computeCharacterStats(ub);
      return { stats: s, atk: s.attacks.find((a) => a.itemId === weaponItem.id)! };
    };
    const axe = () => makeItem({ id: 'axe', name: 'Greataxe', weight: 12, weapon: { damage: '1d12', critRange: 20, critMult: 3, range: 0, type: 'melee', hands: 'two', strDamage: 'full', finesse: false, enhancement: 0, masterwork: false } });
    const jav = () => makeItem({ id: 'jav', name: 'Javelin', weight: 2, weapon: { damage: '1d6', critRange: 20, critMult: 2, range: 30, type: 'thrown', hands: 'one', strDamage: 'full', finesse: false, enhancement: 0, masterwork: false } });
    const bow = () => makeItem({ id: 'bow', name: 'Longbow', weight: 3, weapon: { damage: '1d8', critRange: 20, critMult: 3, range: 100, type: 'ranged', hands: 'two', strDamage: 'none', finesse: false, enhancement: 0, masterwork: false } });

    const axe0 = attackFor(axe(), false);
    const axe1 = attackFor(axe(), true);
    const jav0 = attackFor(jav(), false);
    const jav1 = attackFor(jav(), true);
    const bow0 = attackFor(bow(), false);
    const bow1 = attackFor(bow(), true);

    assert.equal(axe1.atk.attack.total, axe0.atk.attack.total + 2 + 2, 'Unchained Rage +2 untyped stacks with Heroism +2 morale');
    assert.equal(axe1.atk.damage.total, axe0.atk.damage.total + 2, 'Unchained Rage +2 melee damage');
    assert.equal(jav1.atk.attack.total, jav0.atk.attack.total + 2, 'Heroism +2 attack on thrown (Unchained Rage attack is melee-only)');
    assert.equal(jav1.atk.damage.total, jav0.atk.damage.total + 2, 'Unchained Rage +2 thrown weapon damage');
    assert.equal(bow1.atk.damage.total, bow0.atk.damage.total, 'Unchained Rage does not boost bow ranged damage');
    assert.equal(axe1.stats.saves.will.total, axe0.stats.saves.will.total + 2 + 2, 'Unchained Rage +2 Will stacks with Heroism +2 morale');
  });

  test('Uncanny Dodge prevents round-1 flat-footedness before first turn for Barbarian 2+ but not Barbarian 1', () => {
    const setup = (level: number) => {
      const state = createInitialState('s1');
      const c = pcgWith({ classes: [`CLASS:Barbarian|LEVEL:${level}|SKILLPOOL:0`] });
      c.tokenId = 't1';
      state.characters[c.id] = c;
      state.tokens.t1 = createToken({ id: 't1', sceneId: 's1', x: 0, y: 0 });
      state.combat = {
        active: true,
        round: 1,
        currentId: 'cb2',
        combatants: [
          { id: 'cb2', name: 'Orc', tokenId: null, initiative: 20, modifier: 0, hidden: false },
          { id: 'cb1', name: 'Barb', tokenId: 't1', initiative: 5, modifier: 0, hidden: false },
        ],
        ticks: { round: 1, ids: ['cb2'] },
      };
      return effectiveTurn(state, 'cb1');
    };
    assert.equal(setup(1).flatFooted, true, 'Barbarian 1 has no Uncanny Dodge yet');
    assert.equal(setup(2).flatFooted, false, 'Barbarian 2 has Uncanny Dodge and is not flat-footed at start of combat');
  });
});

describe('PF1e rules audit: Bard & Armored Arcane Casters', () => {
  test('casterAsf applies class armored-casting exemptions per class (Bard, Skald, Magus, Bloodrager, Wizard)', () => {
    // Multiclass Bard 4 / Wizard 1 wearing Chain Shirt (20%) + Heavy Wooden Shield (15%).
    const bw = pcgWith({
      classes: ['CLASS:Bard|LEVEL:4|SKILLPOOL:0', 'CLASS:Wizard|LEVEL:1|SKILLPOOL:0'],
      stats: { CHA: 16, INT: 16 },
      spells: ['SPELLNAME:Grease|SCHOOL:Conjuration|DESCRIPTOR:|CLASS:Bard|LEVEL:1|SPELLBOOK:Known Spells|TIMES:1'],
    });
    bw.inventory.items.push(CHAIN_SHIRT(), HEAVY_SHIELD());
    bw.inventory.loadouts[0]!.slots = { cs: 'armor', hs: 'shield' };
    const s = computeCharacterStats(bw);
    const casters = characterSpellcasting(bw, s);
    const bard = casters.find((x) => x.className === 'Bard')!;
    const wiz = casters.find((x) => x.className === 'Wizard')!;
    assert.equal(s.armor.asf, 35, 'raw armor + shield ASF is 35%');
    assert.equal(casterAsf(bard, s), 0, 'Bard ignores light armor and non-tower shields');
    assert.equal(casterAsf(wiz, s), 35, 'Wizard still suffers full 35% ASF');

    const plan = planCast(bw, { className: 'Bard', spellName: 'Grease', level: 1, metamagic: [] });
    assert.notEqual(typeof plan, 'string');
    if (typeof plan !== 'string') {
      const card = spellCard(bw, plan);
      assert.equal(card.text.includes('Arcane spell failure'), false, 'Bard spell card has no ASF warning in light armor + shield');
    }

    // Bard in Breastplate (medium) suffers 25% armor ASF but still ignores Heavy Shield's 15%.
    bw.inventory.items = [BREASTPLATE(), HEAVY_SHIELD()];
    bw.inventory.loadouts[0]!.slots = { bp: 'armor', hs: 'shield' };
    assert.equal(casterAsf(bard, computeCharacterStats(bw)), 25);

    // Bard with Tower Shield suffers Tower Shield's 50% ASF.
    bw.inventory.items = [CHAIN_SHIRT(), TOWER_SHIELD()];
    bw.inventory.loadouts[0]!.slots = { cs: 'armor', ts: 'shield' };
    assert.equal(casterAsf(bard, computeCharacterStats(bw)), 50);

    // Magus ignores light at 1, medium at 7, heavy at 13, but never shields.
    const magus6 = pcgWith({ classes: ['CLASS:Magus|LEVEL:6|SKILLPOOL:0'], stats: { INT: 16 } });
    const magus7 = pcgWith({ classes: ['CLASS:Magus|LEVEL:7|SKILLPOOL:0'], stats: { INT: 16 } });
    const magus13 = pcgWith({ classes: ['CLASS:Magus|LEVEL:13|SKILLPOOL:0'], stats: { INT: 16 } });
    for (const m of [magus6, magus7]) {
      m.inventory.items = [BREASTPLATE(), HEAVY_SHIELD()];
      m.inventory.loadouts[0]!.slots = { bp: 'armor', hs: 'shield' };
    }
    magus13.inventory.items = [FULL_PLATE()];
    magus13.inventory.loadouts[0]!.slots = { fp: 'armor' };
    assert.equal(casterAsf(characterSpellcasting(magus6)[0]!, computeCharacterStats(magus6)), 40, 'Magus 6 suffers medium armor + shield ASF');
    assert.equal(casterAsf(characterSpellcasting(magus7)[0]!, computeCharacterStats(magus7)), 15, 'Magus 7 ignores medium armor, still suffers shield ASF');
    assert.equal(casterAsf(characterSpellcasting(magus13)[0]!, computeCharacterStats(magus13)), 0, 'Magus 13 ignores heavy armor ASF');

    // Skald ignores medium armor + non-tower shields.
    const skald = pcgWith({ classes: ['CLASS:Skald|LEVEL:1|SKILLPOOL:0'], stats: { CHA: 16 } });
    skald.inventory.items = [BREASTPLATE(), HEAVY_SHIELD()];
    skald.inventory.loadouts[0]!.slots = { bp: 'armor', hs: 'shield' };
    assert.equal(casterAsf(characterSpellcasting(skald)[0]!, computeCharacterStats(skald)), 0);
  });

  test('Bard Jack of All Trades: trained-only skills usable at 10th, all skills class skills at 16th', () => {
    const bard9 = pcgWith({ classes: ['CLASS:Bard|LEVEL:9|SKILLPOOL:0'], stats: { DEX: 14 } });
    const bard10 = pcgWith({ classes: ['CLASS:Bard|LEVEL:10|SKILLPOOL:0'], stats: { DEX: 14 } });
    const bard16 = pcgWith({
      classes: ['CLASS:Bard|LEVEL:16|SKILLPOOL:0'],
      stats: { DEX: 14 },
      extra: ['SKILL:Disable Device|OUTPUTORDER:1|CLASSBOUGHT:[CLASS:Bard|RANKS:1.0|COST:1|CLASSSKILL:N]'],
    });
    assert.equal(computeSkills(bard9, computeCharacterStats(bard9)).rows.find((r) => r.name === 'Disable Device')!.usable, false, 'Bard 9 cannot use Disable Device untrained');
    assert.equal(computeSkills(bard10, computeCharacterStats(bard10)).rows.find((r) => r.name === 'Disable Device')!.usable, true, 'Bard 10 Jack of All Trades allows untrained Disable Device');
    const dd16 = computeSkills(bard16, computeCharacterStats(bard16)).rows.find((r) => r.name === 'Disable Device')!;
    assert.equal(dd16.classSkill, true, 'Bard 16 treats Disable Device as a class skill');
    assert.equal(dd16.total.parts.find((p) => p.source === 'Class skill')?.value, 3);
  });

  test('Bardic Performance scales Standard (1-6) -> Move (7-12) -> Swift (13+) in actionCostFor and turn economy', () => {
    const startPerf = lookupPf1Action('c.bard.perform')!;
    assert.equal(actionCostFor(startPerf, 1), 'standard');
    assert.equal(actionCostFor(startPerf, 6), 'standard');
    assert.equal(actionCostFor(startPerf, 7), 'move');
    assert.equal(actionCostFor(startPerf, 12), 'move');
    assert.equal(actionCostFor(startPerf, 13), 'swift');

    // Verify Bard 13 actually spends swift (not standard) via pf1eTurnActions.act in combat.
    const state = createInitialState('s1');
    const bard13 = pcgWith({ classes: ['CLASS:Bard|LEVEL:13|SKILLPOOL:0'], stats: { CHA: 16 } });
    bard13.tokenId = 't1';
    state.characters[bard13.id] = bard13;
    state.tokens.t1 = createToken({ id: 't1', sceneId: 's1', x: 0, y: 0 });
    state.combat = {
      active: true,
      round: 1,
      currentId: 'cb1',
      combatants: [{ id: 'cb1', name: 'Bard', tokenId: 't1', initiative: 15, modifier: 0, hidden: false }],
      ticks: { round: 1, ids: ['cb1'] },
    };
    const payload = { characterId: bard13.id, combatantId: 'cb1', actionId: 'c.bard.perform', chatId: 'm1' };
    assert.equal(pf1eTurnActions.act.authorize({ state, user: { id: 'gm', name: 'GM', role: 'gm', color: '#ffffff' } }, payload), true);
    pf1eTurnActions.act.apply(state, payload, { userId: 'gm', ts: Date.now() });
    assert.equal(state.pf1eTurns.cb1?.swift, true, 'Bard 13 spent swift action');
    assert.equal(state.pf1eTurns.cb1?.standard, false, 'Bard 13 still has standard action');

    // Verify abilities list shows level-adjusted cost label.
    const ability = characterAbilities(bard13).find((a) => a.name === 'Start Bardic Performance');
    assert.ok(ability?.description?.startsWith('Swift.'), `expected Swift., got: ${ability?.description}`);
  });

  test('Extra Performance adds +6 rounds/day and Bard buff presets scale correctly', () => {
    const bard7 = pcgWith({
      classes: ['CLASS:Bard|LEVEL:7|SKILLPOOL:0'],
      stats: { CHA: 16 }, // 4 + 3 + 2*(7-1) = 19; + 6*2 Extra Performance = 31
      extra: [
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Extra Performance',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Extra Performance',
      ],
    });
    assert.equal(characterResources(bard7).find((r) => r.def.id === 'performance')!.max, 31);

    const ic = preset(bard7, 'inspireCourage');
    assert.ok(ic.note.includes('charm and fear'));
    const comp = preset(bard7, 'inspireCompetence');
    assert.deepEqual(comp.effects, [{ target: 'skills', value: 3, type: 'competence' }]);
    const great = preset(bard7, 'inspireGreatness');
    assert.deepEqual(great.effects, [
      { target: 'attack', value: 2, type: 'competence' },
      { target: 'fort', value: 1, type: 'competence' },
    ]);
    const hero = preset(bard7, 'inspireHeroics');
    assert.deepEqual(hero.effects, [
      { target: 'saves', value: 4, type: 'morale' },
      { target: 'ac', value: 4, type: 'dodge' },
    ]);
  });
});

describe('PF1e rules audit: Cleric', () => {
  test('spontaneous conversion handles full alignment names and Neutral Cleric channel energy polarity', () => {
    const ng = pcgWith({ classes: ['CLASS:Cleric|LEVEL:3|SKILLPOOL:0'], stats: { WIS: 16 }, align: 'Neutral Good' });
    const le = pcgWith({ classes: ['CLASS:Cleric|LEVEL:3|SKILLPOOL:0'], stats: { WIS: 16 }, align: 'Lawful Evil' });
    const tnPos = pcgWith({
      classes: ['CLASS:Cleric|LEVEL:3|SKILLPOOL:0'],
      stats: { WIS: 16 },
      align: 'True Neutral',
      extra: ['ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Cleric ~ Channel Positive Energy'],
    });
    const tnNeg = pcgWith({
      classes: ['CLASS:Cleric|LEVEL:3|SKILLPOOL:0'],
      stats: { WIS: 16 },
      align: 'N',
      extra: ['ABILITY:Special Ability|TYPE:NORMAL|CATEGORY:Special Ability|KEY:Channel Negative Energy'],
    });
    const tnOpen = pcgWith({ classes: ['CLASS:Cleric|LEVEL:3|SKILLPOOL:0'], stats: { WIS: 16 }, align: 'TN' });

    assert.deepEqual(characterSpellcasting(ng)[0]!.conversions, ['cure']);
    assert.deepEqual(characterSpellcasting(le)[0]!.conversions, ['inflict']);
    assert.deepEqual(characterSpellcasting(tnPos)[0]!.conversions, ['cure']);
    assert.deepEqual(characterSpellcasting(tnNeg)[0]!.conversions, ['inflict']);
    assert.deepEqual(characterSpellcasting(tnOpen)[0]!.conversions, ['cure', 'inflict']);
  });

  test('Extra Channel adds +2 uses/day and Cleric buff presets scale defaults by caster level', () => {
    const cleric9 = pcgWith({
      classes: ['CLASS:Cleric|LEVEL:9|SKILLPOOL:0'],
      stats: { WIS: 18, CHA: 14 }, // Channel: 3 + 2 + 2*2 Extra Channel = 9
      extra: [
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Extra Channel',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Extra Channel',
      ],
    });
    assert.equal(characterResources(cleric9).find((r) => r.def.id === 'channel')!.max, 9);

    assert.equal(preset(cleric9, 'divinePower').effects.find((e) => e.target === 'attack')?.value, 3, 'CL 9 => +3 luck');
    assert.equal(preset(cleric9, 'divinePower').effects.find((e) => e.target === 'extraAttack')?.value, 1);
    assert.equal(preset(cleric9, 'divineFavor').effects.find((e) => e.target === 'attack')?.value, 3, 'CL 9 => +3 luck');
    assert.equal(preset(cleric9, 'shieldOfFaith').effects[0]!.value, 3, 'CL 9 => +3 deflection');
    assert.equal(preset(cleric9, 'barkskin').effects[0]!.value, 4, 'CL 9 => +4 natural');
  });

  test('Spell Focus applies to rules-pack spells (outside curated spellData) in spellCard', () => {
    const cleric = pcgWith({
      classes: ['CLASS:Cleric|LEVEL:5|SKILLPOOL:0'],
      stats: { WIS: 18 }, // +4 mod
      extra: [
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Spell Focus|APPLIEDTO:Necromancy',
        'ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Greater Spell Focus|APPLIEDTO:Necromancy',
      ],
      spells: ['SPELLNAME:Boneshaker|SCHOOL:Necromancy|DESCRIPTOR:|CLASS:Cleric|LEVEL:2|SPELLBOOK:Prepared|TIMES:1'],
    });
    const fakeRules = {
      byName: (kind: string, name: string) =>
        kind === 'spell' && name === 'Boneshaker'
          ? {
              kind: 'spell' as const,
              id: 'boneshaker',
              name: 'Boneshaker',
              school: 'Necromancy',
              subschool: null,
              descriptors: [],
              classes: { Cleric: 2 },
              castTime: '1 standard action',
              components: 'V, S, F',
              range: 'medium',
              targetArea: 'one living creature or undead creature',
              duration: 'instantaneous',
              save: 'Fortitude half',
              sr: 'yes',
              desc: 'Rattle bones.',
              source: { book: 'Inner Sea Gods', page: 0 },
            }
          : null,
    } as unknown as RulesProvider;

    const info = characterSpellcasting(cleric)[0]!;
    const plan = planCast(cleric, { className: 'Cleric', preparedId: info.prepared[0]!.id });
    assert.notEqual(typeof plan, 'string');
    if (typeof plan !== 'string') {
      const card = spellCard(cleric, plan, cleric.name, fakeRules);
      // Base DC = 10 + 2 (level) + 4 (Wis) + 2 (Spell Focus + Greater Spell Focus Necromancy) = 18.
      assert.ok(card.subtitle.includes('DC 18'), `expected DC 18 in subtitle, got: ${card.subtitle}`);
      assert.ok(card.text.includes('(DC 18)'), `expected (DC 18) in text, got: ${card.text}`);
    }
  });
});

describe('PF1e rules audit: Core Engine (Finesse + Shield ACP, Haste Cap, Monk Fast Movement)', () => {
  test('Weapon Finesse applies shield ACP to finesse melee attacks only', () => {
    const attackWith = (weaponItem: ReturnType<typeof makeItem>) => {
      const f = pcgWith({
        classes: ['CLASS:Fighter|LEVEL:2|SKILLPOOL:0'],
        stats: { STR: 10, DEX: 18 },
        extra: ['ABILITY:FEAT|TYPE:NORMAL|CATEGORY:FEAT|KEY:Weapon Finesse'],
      });
      f.inventory.items.push(weaponItem, HEAVY_SHIELD());
      f.inventory.loadouts[0]!.slots = { [weaponItem.id]: 'primary', hs: 'shield' };
      return computeCharacterStats(f).attacks.find((a) => a.itemId === weaponItem.id)!;
    };
    const rap = attackWith(makeItem({ id: 'rap', name: 'Rapier', weight: 2, weapon: { damage: '1d6', critRange: 18, critMult: 2, range: 0, type: 'melee', hands: 'one', strDamage: 'full', finesse: true, enhancement: 0, masterwork: false } }));
    const ls = attackWith(makeItem({ id: 'ls', name: 'Longsword', weight: 4, weapon: { damage: '1d8', critRange: 19, critMult: 2, range: 0, type: 'melee', hands: 'one', strDamage: 'full', finesse: false, enhancement: 0, masterwork: false } }));
    assert.equal(rap.attack.total, 2 + 4 - 2, 'BAB 2 + Dex 4 - Heavy Shield ACP 2 = +4');
    assert.ok(rap.attack.parts.some((p) => p.value === -2 && /shield/i.test(p.source)));
    assert.equal(ls.attack.total, 2 + 1, 'BAB 2 + Str 1 (Human +2) = +3, no shield ACP');
    assert.equal(ls.attack.parts.some((p) => /shield/i.test(p.source)), false);
  });

  test('Haste speed enhancement caps at 2x normal speed', () => {
    const halfling = pcgWith({ classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'], race: 'Halfling' });
    halfling.runtime.buffs = [preset(halfling, 'haste')];
    assert.equal(computeCharacterStats(halfling).speed.total, 40, '20 ft base + Haste capped at +20 = 40 ft');

    const human = pcgWith({ classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'], race: 'Human' });
    human.runtime.buffs = [preset(human, 'haste')];
    assert.equal(computeCharacterStats(human).speed.total, 60, '30 ft base + 30 Haste = 60 ft');
  });

  test('Monk Fast Movement adds +10 ft per 3 levels when unarmored and in light load', () => {
    const monk6 = pcgWith({ classes: ['CLASS:Monk|LEVEL:6|SKILLPOOL:0'], stats: { STR: 14 } });
    assert.equal(computeCharacterStats(monk6).speed.total, 50, '30 + 20 enhancement at Monk 6');

    monk6.inventory.items.push(CHAIN_SHIRT());
    monk6.inventory.loadouts[0]!.slots = { cs: 'armor' };
    assert.equal(computeCharacterStats(monk6).speed.total, 30, 'wearing armor disables Monk Fast Movement');
  });

  test('armor speed reduction matches PF1e armor table across base speeds', () => {
    const halfling = pcgWith({ classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'], race: 'Halfling' });
    halfling.inventory.items.push(FULL_PLATE());
    halfling.inventory.loadouts[0]!.slots = { fp: 'armor' };
    assert.equal(computeCharacterStats(halfling).speed.total, 15, '20 ft reduced to 15 ft in heavy armor');

    const human = pcgWith({ classes: ['CLASS:Fighter|LEVEL:1|SKILLPOOL:0'], race: 'Human' });
    human.inventory.items.push(FULL_PLATE());
    human.inventory.loadouts[0]!.slots = { fp: 'armor' };
    assert.equal(computeCharacterStats(human).speed.total, 20, '30 ft reduced to 20 ft in heavy armor');
  });
});
