/**
 * Buffs and conditions (Epic 8): preset temporary effects (Bless, Haste,
 * Rage...), the mechanical effects of PF1e conditions (Shaken, Prone...), and
 * `characterEffects`, which turns a character's active buffs and conditions
 * into typed modifiers for the stat engine. PF1e stacking is applied later by
 * `sumModifiers`, so two morale bonuses never add up but penalties do.
 *
 * Presets are templates: adding one stores its effects on the character
 * (scaled for its class levels and the chosen option), so every buff, preset
 * or custom, is the same editable list of typed modifiers.
 */
import type { Buff, BuffEffect, BuffTarget, Character } from '../entities/pf1e';
import type { BonusType, Modifier } from './modifiers';
import { normalizeName, type StatKey } from './rules';
import { TOGGLES } from './toggles';

type T = BonusType;
const e = (target: BuffTarget, value: number, type: T = 'untyped'): BuffEffect => ({ target, value, type: type as BuffEffect['type'] });

/** Levels in a class (by normalized name, e.g. "barbarian" also matches "Barbarian (Unchained)" only if listed). */
export function classLevelOf(c: Character, ...names: string[]): number {
  const keys = names.map(normalizeName);
  return c.build.classes.filter((k) => keys.includes(normalizeName(k.name))).reduce((s, k) => s + k.level, 0);
}

// ------------------------------------------------------------------ presets

export interface PresetOption {
  label: string;
  choices: { value: string; label: string }[];
  /** Default choice for this character (e.g. its own bard level's Inspire Courage bonus). */
  initial: (c: Character) => string;
}

export interface PresetContext {
  /** Ability modifier of the character (for Smite). */
  mod: (k: StatKey) => number;
}

export interface BuffPreset {
  id: string;
  name: string;
  group: 'Spells' | 'Class abilities' | 'Combat';
  note: string;
  option?: PresetOption;
  /** Token condition marker that means the same thing (Hasted, Raging...). */
  condition?: string;
  /** Only offered when the character has one of these classes (empty = everyone). */
  classes?: string[];
  effects: (c: Character, option: string, ctx: PresetContext) => BuffEffect[];
}

const rank = (levels: number[], level: number) => levels.filter((l) => level >= l).length;
const choices = (values: (string | number)[], label = (v: string) => v) => values.map((v) => ({ value: String(v), label: label(String(v)) }));

const ABILITY_SPELLS: [string, string, StatKey][] = [
  ['bullsStrength', "Bull's Strength", 'STR'],
  ['catsGrace', "Cat's Grace", 'DEX'],
  ['bearsEndurance', "Bear's Endurance", 'CON'],
  ['foxsCunning', "Fox's Cunning", 'INT'],
  ['owlsWisdom', "Owl's Wisdom", 'WIS'],
  ['eaglesSplendor', "Eagle's Splendor", 'CHA'],
];

const MUTAGEN_PAIR: Record<string, StatKey> = { STR: 'INT', DEX: 'WIS', CON: 'CHA' };

export const BUFF_PRESETS: BuffPreset[] = [
  // ---- spells
  { id: 'bless', name: 'Bless', group: 'Spells', condition: 'Blessed', note: '+1 morale on saves against fear.', effects: () => [e('attack', 1, 'morale')] },
  { id: 'bane', name: 'Bane', group: 'Spells', note: '−1 on saves against fear.', effects: () => [e('attack', -1)] },
  {
    id: 'prayer',
    name: 'Prayer',
    group: 'Spells',
    note: 'Enemies in the area take −1 on the same rolls.',
    effects: () => [e('attack', 1, 'luck'), e('damage', 1, 'luck'), e('saves', 1, 'luck'), e('skills', 1, 'luck')],
  },
  { id: 'heroism', name: 'Heroism', group: 'Spells', note: '', effects: () => [e('attack', 2, 'morale'), e('saves', 2, 'morale'), e('skills', 2, 'morale')] },
  {
    id: 'divineFavor',
    name: 'Divine Favor',
    group: 'Spells',
    note: 'Luck bonus on attack and weapon damage rolls: +1 per three caster levels (+1 to +3).',
    option: { label: 'Bonus', choices: choices([1, 2, 3], (v) => `+${v}`), initial: () => '1' },
    effects: (_c, o) => [e('attack', Number(o), 'luck'), e('damage', Number(o), 'luck')],
  },
  {
    id: 'haste',
    name: 'Haste',
    group: 'Spells',
    condition: 'Hasted',
    note: 'One extra attack at your highest bonus on a full attack. Speed bonus up to twice your normal speed.',
    effects: () => [e('attack', 1), e('ac', 1, 'dodge'), e('ref', 1, 'dodge'), e('speed', 30, 'enhancement'), e('extraAttack', 1)],
  },
  {
    id: 'slow',
    name: 'Slow',
    group: 'Spells',
    condition: 'Slowed',
    note: 'Staggered: only a single move or standard action each turn. Half speed.',
    effects: () => [e('attack', -1), e('ac', -1), e('ref', -1)],
  },
  {
    id: 'enlargePerson',
    name: 'Enlarge Person',
    group: 'Spells',
    note: 'Reach grows with size; weapon damage dice are sized up.',
    effects: () => [e('sizeSteps', 1), e('STR', 2, 'size'), e('DEX', -2, 'size')],
  },
  { id: 'reducePerson', name: 'Reduce Person', group: 'Spells', note: 'Weapon damage dice are sized down.', effects: () => [e('sizeSteps', -1), e('STR', -2, 'size'), e('DEX', 2, 'size')] },
  ...ABILITY_SPELLS.map(([id, name, stat]): BuffPreset => ({ id, name, group: 'Spells', note: '', effects: () => [e(stat, 4, 'enhancement')] })),
  { id: 'mageArmor', name: 'Mage Armor', group: 'Spells', note: 'Armor bonus: doesn’t stack with worn armor; works against incorporeal touch attacks.', effects: () => [e('ac', 4, 'armor')] },
  { id: 'shield', name: 'Shield', group: 'Spells', note: 'Shield bonus: doesn’t stack with a carried shield. Negates magic missile.', effects: () => [e('ac', 4, 'shield')] },
  {
    id: 'shieldOfFaith',
    name: 'Shield of Faith',
    group: 'Spells',
    note: '+2 deflection, +1 per six caster levels (max +5).',
    option: { label: 'Bonus', choices: choices([2, 3, 4, 5], (v) => `+${v}`), initial: () => '2' },
    effects: (_c, o) => [e('ac', Number(o), 'deflection')],
  },
  {
    id: 'barkskin',
    name: 'Barkskin',
    group: 'Spells',
    note: '+2 enhancement to natural armor, +1 per three caster levels above 3rd (max +5). Counted here as natural armor.',
    option: { label: 'Bonus', choices: choices([2, 3, 4, 5], (v) => `+${v}`), initial: () => '2' },
    effects: (_c, o) => [e('ac', Number(o), 'natural')],
  },
  {
    id: 'rageSpell',
    name: 'Rage (spell)',
    group: 'Spells',
    note: 'Can’t use skills that need patience or concentration.',
    effects: () => [e('STR', 2, 'morale'), e('CON', 2, 'morale'), e('will', 1, 'morale'), e('ac', -2)],
  },
  // ---- class abilities
  {
    id: 'rage',
    name: 'Rage',
    group: 'Class abilities',
    condition: 'Raging',
    classes: ['barbarian'],
    note: 'Greater rage (11th) and mighty rage (20th) included. No skills that need patience or concentration; fatigued afterwards.',
    effects: (c) => {
      const r = rank([11, 20], classLevelOf(c, 'barbarian'));
      return [e('STR', 4 + 2 * r, 'morale'), e('CON', 4 + 2 * r, 'morale'), e('will', 2 + r, 'morale'), e('ac', -2)];
    },
  },
  {
    id: 'unchainedRage',
    name: 'Rage (unchained)',
    group: 'Class abilities',
    classes: ['barbarianunchained', 'unchainedbarbarian'],
    note: 'Also +2 temporary hit points per Hit Die (+3 greater, +4 mighty) and the same bonus on thrown weapon damage. Fatigued afterwards.',
    effects: (c) => {
      const b = 2 + rank([11, 20], classLevelOf(c, 'barbarianunchained', 'unchainedbarbarian'));
      return [e('attackMelee', b), e('damageMelee', b), e('will', b), e('ac', -2)];
    },
  },
  {
    id: 'inspiredRage',
    name: 'Inspired Rage',
    group: 'Class abilities',
    note: 'From a skald: +2/+2/+1 morale (+4/+4/+2 at 8th, +6/+6/+3 at 16th). Can’t use concentration skills.',
    option: {
      label: 'Skald level',
      choices: [
        { value: '1', label: '1st–7th' },
        { value: '2', label: '8th–15th' },
        { value: '3', label: '16th+' },
      ],
      initial: (c) => String(1 + rank([8, 16], classLevelOf(c, 'skald'))),
    },
    effects: (_c, o) => [e('STR', 2 * Number(o), 'morale'), e('CON', 2 * Number(o), 'morale'), e('will', Number(o), 'morale'), e('ac', -2)],
  },
  {
    id: 'inspireCourage',
    name: 'Inspire Courage',
    group: 'Class abilities',
    note: 'From a bard: competence bonus on attack and weapon damage rolls (+1, +2 at 5th, +3 at 11th, +4 at 17th) and a morale bonus on saves against fear.',
    option: {
      label: 'Bonus',
      choices: choices([1, 2, 3, 4], (v) => `+${v}`),
      initial: (c) => String(1 + rank([5, 11, 17], classLevelOf(c, 'bard'))),
    },
    effects: (_c, o) => [e('attack', Number(o), 'competence'), e('damage', Number(o), 'competence')],
  },
  {
    id: 'mutagen',
    name: 'Mutagen',
    group: 'Class abilities',
    classes: ['alchemist', 'investigator'],
    note: 'Physical ability +4 alchemical, its paired mental ability −2, +2 natural armor.',
    option: {
      label: 'Ability',
      choices: [
        { value: 'STR', label: 'Str (−2 Int)' },
        { value: 'DEX', label: 'Dex (−2 Wis)' },
        { value: 'CON', label: 'Con (−2 Cha)' },
      ],
      initial: () => 'STR',
    },
    effects: (_c, o) => [e(o as StatKey, 4, 'alchemical'), e(MUTAGEN_PAIR[o]!, -2, 'alchemical'), e('ac', 2, 'natural')],
  },
  {
    id: 'smiteEvil',
    name: 'Smite Evil',
    group: 'Class abilities',
    classes: ['paladin'],
    note: 'Against the smitten target only: Cha to attack, paladin level to damage (doubled on the first hit against evil outsiders, dragons and undead), Cha as deflection to AC.',
    effects: (c, _o, ctx) => {
      const cha = Math.max(0, ctx.mod('CHA'));
      return [e('attack', cha), e('damage', classLevelOf(c, 'paladin')), e('ac', cha, 'deflection')];
    },
  },
  {
    id: 'smiteGood',
    name: 'Smite Good',
    group: 'Class abilities',
    classes: ['antipaladin'],
    note: 'Against the smitten target only: Cha to attack, antipaladin level to damage, Cha as deflection to AC.',
    effects: (c, _o, ctx) => {
      const cha = Math.max(0, ctx.mod('CHA'));
      return [e('attack', cha), e('damage', classLevelOf(c, 'antipaladin')), e('ac', cha, 'deflection')];
    },
  },
  {
    id: 'judgment',
    name: 'Judgment',
    group: 'Class abilities',
    classes: ['inquisitor'],
    note: 'Sacred bonus (profane if evil). Other judgments (healing, piercing, resiliency, resistance, smiting) aren’t modelled: note them here.',
    option: {
      label: 'Judgment',
      choices: [
        { value: 'destruction', label: 'Destruction (damage)' },
        { value: 'justice', label: 'Justice (attack)' },
        { value: 'protection', label: 'Protection (AC)' },
        { value: 'purity', label: 'Purity (saves)' },
      ],
      initial: () => 'justice',
    },
    effects: (c, o) => {
      const lvl = classLevelOf(c, 'inquisitor');
      const per5 = 1 + Math.floor(lvl / 5);
      if (o === 'destruction') return [e('damage', 1 + Math.floor(lvl / 3), 'sacred')];
      if (o === 'protection') return [e('ac', per5, 'sacred')];
      if (o === 'purity') return [e('saves', per5, 'sacred')];
      return [e('attack', per5, 'sacred')];
    },
  },
  {
    id: 'studiedTarget',
    name: 'Studied Target',
    group: 'Class abilities',
    classes: ['slayer'],
    note: 'Against the studied target only; the same bonus applies to Bluff, Knowledge, Perception, Sense Motive and Survival checks against it.',
    effects: (c) => {
      const b = 1 + Math.floor(classLevelOf(c, 'slayer') / 5);
      return [e('attack', b), e('damage', b)];
    },
  },
  {
    id: 'arcanePool',
    name: 'Arcane Pool weapon',
    group: 'Class abilities',
    classes: ['magus'],
    note: 'Adds to the weapon’s own enhancement bonus (max +5 total), or buys weapon special abilities instead.',
    effects: (c) => {
      const b = 1 + Math.floor((Math.max(1, classLevelOf(c, 'magus')) - 1) / 4);
      return [e('attackMelee', b), e('damageMelee', b)];
    },
  },
  // ---- combat situations
  { id: 'flanking', name: 'Flanking', group: 'Combat', note: 'Melee attacks against a flanked target.', effects: () => [e('attackMelee', 2)] },
  { id: 'charge', name: 'Charge', group: 'Combat', note: 'Until your next turn.', effects: () => [e('attackMelee', 2), e('ac', -2)] },
  { id: 'cover', name: 'Cover', group: 'Combat', note: 'Soft cover gives no Reflex bonus.', effects: () => [e('ac', 4), e('ref', 2)] },
];

export function lookupPreset(id: string): BuffPreset | undefined {
  return BUFF_PRESETS.find((p) => p.id === id);
}

/** Presets offered to a character: class abilities only for its classes. */
export function presetsFor(c: Character): BuffPreset[] {
  return BUFF_PRESETS.filter((p) => !p.classes || p.classes.some((k) => classLevelOf(c, k) > 0));
}

/** A buff built from a preset, scaled for the character. */
export function presetBuff(c: Character, preset: BuffPreset, option: string | undefined, ctx: PresetContext, id: string): Buff {
  const opt = option ?? preset.option?.initial(c) ?? '';
  const chosen = preset.option?.choices.find((x) => x.value === opt);
  return {
    id,
    presetId: preset.id,
    name: (chosen && preset.option!.choices.length > 1 && preset.id !== 'divineFavor' ? `${preset.name} (${chosen.label})` : preset.name).slice(0, 60),
    effects: preset.effects(c, opt, ctx),
    note: preset.note.slice(0, 300),
    active: true,
    roundsLeft: null,
  };
}

/**
 * Temporary bonuses PCGen had switched on (`TEMPBONUS`), matched to presets
 * where possible. Combat options that are toggles on the sheet (Power Attack...)
 * are left out so they can't count twice.
 */
export function tempBonusSuggestions(c: Character): { name: string; description: string | null; preset: BuffPreset | null }[] {
  const out: { name: string; description: string | null; preset: BuffPreset | null }[] = [];
  const toggleKeys = new Set(TOGGLES.map((t) => normalizeName(t.label)));
  for (const t of c.build.tempBonuses) {
    const name = (t.name.split('=').pop() ?? t.name).replace(/^[A-Z]+:/, '').trim().slice(0, 60);
    const key = normalizeName(name);
    if (!name || toggleKeys.has(key) || out.some((x) => x.name === name)) continue;
    out.push({ name, description: t.description, preset: BUFF_PRESETS.find((p) => normalizeName(p.name) === key || normalizeName(p.id) === key) ?? null });
  }
  return out;
}

// ------------------------------------------------------------------ conditions

interface ConditionRule {
  effects: BuffEffect[];
  loseDexToAc?: boolean;
  /** Ability treated as a score of 0 (helpless, paralyzed). */
  zero?: StatKey[];
  note?: string;
  /** Conditions of a group don't stack: only the worst (highest rank) applies. */
  group?: { id: 'fear' | 'fatigue'; rank: number };
  /** Implies another condition (unconscious -> helpless). */
  implies?: string[];
}

const FEAR = [e('attack', -2), e('saves', -2), e('skills', -2)];

/** PF1e Core Rulebook Appendix 2 conditions with numeric effects (keys normalized). */
const CONDITIONS: Record<string, ConditionRule> = {
  blinded: { effects: [e('ac', -2)], loseDexToAc: true, note: 'Blinded: everything has total concealment (50% miss chance); −4 on Str- and Dex-based skill checks and opposed Perception; half speed.' },
  cowering: { effects: [e('ac', -2)], loseDexToAc: true, note: 'Cowering: can take no actions.' },
  dazzled: { effects: [e('attack', -1)], note: 'Dazzled: −1 on sight-based Perception checks.' },
  deafened: { effects: [e('initiative', -4)], note: 'Deafened: 20% spell failure with verbal components; fails sound-based Perception.' },
  entangled: { effects: [e('attack', -2), e('DEX', -4)], note: 'Entangled: half speed; concentration check to cast.' },
  fatigued: { effects: [e('STR', -2), e('DEX', -2)], group: { id: 'fatigue', rank: 1 }, note: 'Fatigued: can’t run or charge.' },
  exhausted: { effects: [e('STR', -6), e('DEX', -6)], group: { id: 'fatigue', rank: 2 }, note: 'Exhausted: half speed, can’t run or charge.' },
  flatfooted: { effects: [], loseDexToAc: true, note: 'Flat-footed: no attacks of opportunity.' },
  shaken: { effects: FEAR, group: { id: 'fear', rank: 1 } },
  frightened: { effects: FEAR, group: { id: 'fear', rank: 2 }, note: 'Frightened: flees from the source of fear.' },
  panicked: { effects: FEAR, group: { id: 'fear', rank: 3 }, note: 'Panicked: drops held items and flees.' },
  grappled: { effects: [e('attack', -2), e('cmb', -2), e('DEX', -4)], note: 'Grappled: the −2 doesn’t apply to checks to grapple or escape; can’t move; concentration check to cast.' },
  pinned: { effects: [e('ac', -4)], loseDexToAc: true, note: 'Pinned: can only try to escape.' },
  helpless: { effects: [], zero: ['DEX'], note: 'Helpless: melee attacks against you get +4; coup de grace possible.' },
  paralyzed: { effects: [], zero: ['STR', 'DEX'], implies: ['helpless'] },
  unconscious: { effects: [], implies: ['helpless'] },
  prone: { effects: [e('attackMelee', -4)], note: 'Prone: −4 AC against melee, +4 AC against ranged; only crossbows and firearms for ranged attacks.' },
  sickened: { effects: [e('attack', -2), e('damage', -2), e('saves', -2), e('skills', -2)] },
  stunned: { effects: [e('ac', -2)], loseDexToAc: true, note: 'Stunned: drops everything held, can take no actions.' },
  staggered: { effects: [], note: 'Staggered: a single move or standard action each turn.' },
  nauseated: { effects: [], note: 'Nauseated: only a single move action each turn.' },
  dazed: { effects: [], note: 'Dazed: can take no actions.' },
  confused: { effects: [], note: 'Confused: roll each turn for what you do.' },
  invisible: { effects: [e('attack', 2)], note: 'Invisible: +2 on attacks against sighted foes, who lose their Dex bonus to AC.' },
};

/** Whether a condition name has rules the engine applies (numbers or notes). */
export function conditionRule(name: string): ConditionRule | undefined {
  return CONDITIONS[normalizeName(name)];
}

// ------------------------------------------------------------------ gathering

export interface EffectSource {
  name: string;
  kind: 'buff' | 'condition';
  roundsLeft: number | null;
}

export interface CharacterEffects {
  /** Typed modifiers per target, ready for sumModifiers. */
  mods: Record<BuffTarget, Modifier[]>;
  loseDexToAc: boolean;
  zero: StatKey[];
  /** Reminders the numbers don't cover. */
  notes: string[];
  sources: EffectSource[];
}

const TARGETS: BuffTarget[] = [
  'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'attack', 'attackMelee', 'attackRanged', 'damage', 'damageMelee', 'damageRanged',
  'ac', 'cmb', 'cmd', 'initiative', 'saves', 'fort', 'ref', 'will', 'skills', 'speed', 'casterLevel', 'sizeSteps', 'extraAttack',
];

/** The character's conditions with implied ones added, the worst of each non-stacking group kept. */
export function effectiveConditions(names: string[]): string[] {
  const keys = new Set(names.map(normalizeName));
  for (const k of [...keys]) for (const i of CONDITIONS[k]?.implies ?? []) keys.add(i);
  const best = new Map<string, [string, number]>();
  for (const k of keys) {
    const g = CONDITIONS[k]?.group;
    if (g && (best.get(g.id)?.[1] ?? 0) < g.rank) best.set(g.id, [k, g.rank]);
  }
  return [...keys].filter((k) => {
    const g = CONDITIONS[k]?.group;
    return !g || best.get(g.id)?.[0] === k;
  });
}

const titleCase = (k: string, names: string[]) => names.find((n) => normalizeName(n) === k) ?? k.charAt(0).toUpperCase() + k.slice(1);

/**
 * Everything temporarily changing a character's numbers: active buffs and
 * conditions. A condition marker that names a preset (Hasted, Raging...)
 * applies that preset unless a buff from it is already active.
 */
export function characterEffects(c: Character): CharacterEffects {
  const mods = Object.fromEntries(TARGETS.map((t) => [t, [] as Modifier[]])) as Record<BuffTarget, Modifier[]>;
  const out: CharacterEffects = { mods, loseDexToAc: false, zero: [], notes: [], sources: [] };
  const add = (effects: BuffEffect[], source: string) => {
    for (const fx of effects) mods[fx.target].push({ value: fx.value, type: fx.type as BonusType, source });
  };

  const active = c.runtime.buffs.filter((b) => b.active);
  for (const b of active) {
    add(b.effects, b.name);
    if (b.note.trim()) out.notes.push(`${b.name}: ${b.note.trim()}`);
    out.sources.push({ name: b.name, kind: 'buff', roundsLeft: b.roundsLeft });
  }

  const conditions = c.runtime.conditions;
  for (const k of effectiveConditions(conditions)) {
    const label = titleCase(k, conditions);
    const preset = BUFF_PRESETS.find((p) => p.condition && normalizeName(p.condition) === k);
    if (preset) {
      if (active.some((b) => b.presetId === preset.id)) continue;
      // Ability-free presets only (conditions can't ask for an option): use the default choice.
      add(preset.effects(c, preset.option?.initial(c) ?? '', { mod: () => 0 }), label);
      out.sources.push({ name: label, kind: 'condition', roundsLeft: null });
      continue;
    }
    const rule = CONDITIONS[k];
    if (!rule) continue;
    add(rule.effects, label);
    if (rule.loseDexToAc) out.loseDexToAc = true;
    for (const z of rule.zero ?? []) if (!out.zero.includes(z)) out.zero.push(z);
    if (rule.note) out.notes.push(rule.note);
    out.sources.push({ name: label, kind: 'condition', roundsLeft: null });
  }
  return out;
}

/** Bonus types that also raise CMD when they apply to AC (and every AC penalty does). */
export const CMD_FROM_AC = new Set<BonusType>(['circumstance', 'deflection', 'dodge', 'insight', 'luck', 'morale', 'profane', 'sacred']);
/** AC bonus types that don't apply to touch AC. */
export const NOT_TOUCH = new Set<BonusType>(['armor', 'shield', 'natural']);

/** "Bless: +1 morale attack" style summary of an effect list. */
export function describeEffects(effects: BuffEffect[]): string {
  const label: Record<BuffTarget, string> = {
    STR: 'Str', DEX: 'Dex', CON: 'Con', INT: 'Int', WIS: 'Wis', CHA: 'Cha', attack: 'attack', attackMelee: 'melee attack', attackRanged: 'ranged attack',
    damage: 'damage', damageMelee: 'melee damage', damageRanged: 'ranged damage', ac: 'AC', cmb: 'CMB', cmd: 'CMD', initiative: 'initiative',
    saves: 'saves', fort: 'Fort', ref: 'Ref', will: 'Will', skills: 'skills', speed: 'ft. speed', casterLevel: 'caster level', sizeSteps: 'size', extraAttack: 'extra attack',
  };
  return effects
    .map((fx) => {
      if (fx.target === 'extraAttack') return '+1 attack on full attacks';
      if (fx.target === 'sizeSteps') return fx.value > 0 ? `${fx.value} size larger` : `${-fx.value} size smaller`;
      const n = fx.value >= 0 ? `+${fx.value}` : `−${-fx.value}`;
      return `${n}${fx.type !== 'untyped' ? ` ${fx.type}` : ''} ${label[fx.target]}`;
    })
    .join(', ');
}
