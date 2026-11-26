/**
 * PF1e skills: the reference table, totals from imported ranks plus sheet
 * overrides, and situational modifiers offered when rolling. Pure; shared by
 * the sheet UI and tests.
 */
import type { Character, SkillOverride } from '../entities/pf1e';
import type { CharacterStats } from './engine';
import { sumModifiers, type Modifier, type StatLine } from './modifiers';
import { featKey, lookupRace, normalizeName, type SizeName, type StatKey } from './rules';

export interface SkillDef {
  name: string;
  ability: StatKey;
  trainedOnly: boolean;
  /** Armor check penalty applies. */
  acp: boolean;
  /** Needs a sub-skill: Craft (...), Knowledge (...), Perform (...), Profession (...). */
  family?: boolean;
}

const s = (name: string, ability: StatKey, trainedOnly = false, acp = false, family = false): SkillDef => ({ name, ability, trainedOnly, acp, family });

/** Core Rulebook skills. */
export const SKILLS: SkillDef[] = [
  s('Acrobatics', 'DEX', false, true),
  s('Appraise', 'INT'),
  s('Bluff', 'CHA'),
  s('Climb', 'STR', false, true),
  s('Craft', 'INT', false, false, true),
  s('Diplomacy', 'CHA'),
  s('Disable Device', 'DEX', true, true),
  s('Disguise', 'CHA'),
  s('Escape Artist', 'DEX', false, true),
  s('Fly', 'DEX', false, true),
  s('Handle Animal', 'CHA', true),
  s('Heal', 'WIS'),
  s('Intimidate', 'CHA'),
  s('Knowledge', 'INT', true, false, true),
  s('Linguistics', 'INT', true),
  s('Perception', 'WIS'),
  s('Perform', 'CHA', false, false, true),
  s('Profession', 'WIS', true, false, true),
  s('Ride', 'DEX', false, true),
  s('Sense Motive', 'WIS'),
  s('Sleight of Hand', 'DEX', true, true),
  s('Spellcraft', 'INT', true),
  s('Stealth', 'DEX', false, true),
  s('Survival', 'WIS'),
  s('Swim', 'STR', false, true),
  s('Use Magic Device', 'CHA', true),
];

export const KNOWLEDGES = ['Arcana', 'Dungeoneering', 'Engineering', 'Geography', 'History', 'Local', 'Nature', 'Nobility', 'Planes', 'Religion'];
export const SKILL_FAMILIES = SKILLS.filter((d) => d.family).map((d) => d.name);

const STEALTH_SIZE: Record<SizeName, number> = { Fine: 16, Diminutive: 12, Tiny: 8, Small: 4, Medium: 0, Large: -4, Huge: -8, Gargantuan: -12, Colossal: -16 };
const FLY_SIZE: Record<SizeName, number> = { Fine: 8, Diminutive: 6, Tiny: 4, Small: 2, Medium: 0, Large: -2, Huge: -4, Gargantuan: -6, Colossal: -8 };

/** "Knowledge (Arcana)" -> ["Knowledge", "Arcana"]. */
export function splitSkillName(name: string): [string, string | null] {
  const m = /^([^(]+?)\s*\((.+)\)\s*$/.exec(name.trim());
  return m ? [m[1]!.trim(), m[2]!.trim()] : [name.trim(), null];
}

export function skillDef(name: string): SkillDef | undefined {
  const [base] = splitSkillName(name);
  const lower = base.toLowerCase();
  return SKILLS.find((d) => d.name.toLowerCase() === lower);
}

/** PCGen pseudo-entries that aren't real skills ("Untrained Wisdom", "Bluff (Perform (Act))", "Samurai Mount"...). */
function isPseudoSkill(name: string): boolean {
  if (/^untrained\b/i.test(name) || /\(untrained\)$/i.test(name)) return true;
  const [base, sub] = splitSkillName(name);
  const def = skillDef(base);
  if (!def) return true;
  // Versatile Performance etc. show up as "<Skill> (Perform (...))" on non-family skills.
  return !def.family && sub !== null;
}

/** Feats giving +2 to two skills (+4 to a skill with 10+ ranks). */
const PAIR_FEATS: Record<string, [string, string]> = {
  acrobatic: ['Acrobatics', 'Fly'],
  alertness: ['Perception', 'Sense Motive'],
  animalaffinity: ['Handle Animal', 'Ride'],
  athletic: ['Climb', 'Swim'],
  deceitful: ['Bluff', 'Disguise'],
  defthands: ['Disable Device', 'Sleight of Hand'],
  magicalaptitude: ['Spellcraft', 'Use Magic Device'],
  persuasive: ['Diplomacy', 'Intimidate'],
  selfsufficient: ['Heal', 'Survival'],
  stealthy: ['Escape Artist', 'Stealth'],
};

const classLevel = (c: Character, ...keys: string[]) =>
  c.build.classes.filter((k) => keys.includes(normalizeName(k.name))).reduce((sum, k) => sum + k.level, 0);
const halfLevel = (lvl: number) => Math.max(1, Math.floor(lvl / 2));

/** Always-on class features that change skill totals. */
function classSkillBonuses(c: Character, skill: string): Modifier[] {
  const [base] = splitSkillName(skill);
  const lower = skill.toLowerCase();
  const out: Modifier[] = [];
  const bard = classLevel(c, 'bard', 'skald');
  if (bard && base.toLowerCase() === 'knowledge') out.push({ value: halfLevel(bard), type: 'untyped', source: 'Bardic knowledge' });
  const druid = classLevel(c, 'druid');
  if (druid && (lower === 'knowledge (nature)' || lower === 'survival')) out.push({ value: 2, type: 'untyped', source: 'Nature sense' });
  const inquisitor = classLevel(c, 'inquisitor');
  if (inquisitor && (lower === 'intimidate' || lower === 'sense motive')) out.push({ value: halfLevel(inquisitor), type: 'morale', source: 'Stern gaze' });
  const mesmerist = classLevel(c, 'mesmerist');
  if (mesmerist && lower === 'bluff') out.push({ value: halfLevel(mesmerist), type: 'untyped', source: 'Consummate liar' });
  return out;
}

/** Names of feats with what they apply to ("Skill Focus" -> ["Perception"]). */
function featsWithTargets(c: Character): { key: string; targets: string[]; name: string }[] {
  const out = c.build.abilities.map((a) => ({ key: featKey(a.key), targets: a.appliedTo.map((t) => t.trim()).filter(Boolean), name: a.key }));
  for (const f of [...c.build.legacyFeats, ...c.build.virtualFeats]) {
    const m = /\((.+)\)\s*$/.exec(f);
    out.push({ key: featKey(f), targets: m ? [m[1]!.trim()] : [], name: f });
  }
  return out;
}

export interface SkillRow {
  name: string;
  def: SkillDef | null;
  ability: StatKey | null;
  ranks: number;
  /** Ranks in the .pcg file (before any sheet override). */
  fileRanks: number;
  classSkill: boolean;
  trainedOnly: boolean;
  /** Can be attempted (trained-only skills need ranks; Bardic knowledge allows untrained Knowledge). */
  usable: boolean;
  favorite: boolean;
  custom: boolean;
  total: StatLine;
  override: SkillOverride | undefined;
}

export interface SkillSummary {
  rows: SkillRow[];
  totalRanks: number;
  /** Max ranks in any one skill (= hit dice). */
  maxRanks: number;
  warnings: string[];
}

/** Canonicalize known skill/Knowledge names so "Knowledge (arcana)" merges cleanly with "Knowledge (Arcana)". */
function canonicalSkillName(raw: string): string {
  const trimmed = raw.trim();
  const [base, sub] = splitSkillName(trimmed);
  const def = skillDef(base);
  if (!def) return trimmed;
  if (!sub) return def.name;
  if (def.name === 'Knowledge') {
    const known = KNOWLEDGES.find((k) => k.toLowerCase() === sub.toLowerCase());
    if (known) return `Knowledge (${known})`;
  }
  return `${def.name} (${sub})`;
}

/** Every skill row: core skills, the ten Knowledges, sub-skills from the file or added on the sheet. */
export function computeSkills(c: Character, stats: CharacterStats): SkillSummary {
  const race = lookupRace(c.build.attributes.race);
  const racialByLower = new Map<string, { name: string; bonus: number }>();
  if (race?.skills) {
    for (const [k, v] of Object.entries(race.skills)) racialByLower.set(k.toLowerCase(), { name: k, bonus: v });
  }

  const canonical = (raw: string) => {
    const cName = canonicalSkillName(raw);
    return racialByLower.get(cName.toLowerCase())?.name ?? cName;
  };

  const fileRanks = new Map<string, { ranks: number; classSkill: boolean }>();
  const fileNames: string[] = [];
  for (const sk of c.build.skills) {
    const name = canonical(sk.name);
    const ranks = Math.max(0, Math.floor(sk.totalRanks));
    if (isPseudoSkill(name) && ranks <= 0) continue;
    const prev = fileRanks.get(name);
    fileRanks.set(name, {
      ranks: Math.max(prev?.ranks ?? 0, ranks),
      classSkill: (prev?.classSkill ?? false) || sk.classBought.some((b) => b.classSkill === true),
    });
    fileNames.push(name);
  }
  const overrides = c.sheet.skills;
  const overrideByLower = new Map<string, SkillOverride>();
  for (const [k, v] of Object.entries(overrides)) overrideByLower.set(canonical(k).toLowerCase(), v);

  const names = new Set<string>();
  for (const d of SKILLS) if (!d.family) names.add(d.name);
  for (const k of KNOWLEDGES) names.add(`Knowledge (${k})`);
  names.add('Craft');
  names.add('Perform');
  if (race?.skills) for (const n of Object.keys(race.skills)) names.add(n);
  for (const n of fileNames) if (!isPseudoSkill(n) || (fileRanks.get(n)?.ranks ?? 0) > 0) names.add(n);
  for (const [n, o] of Object.entries(overrides)) {
    const cn = canonical(n);
    if (o.custom || skillDef(cn)) names.add(cn);
  }

  const feats = featsWithTargets(c);
  const bardic = classLevel(c, 'bard', 'skald') > 0;
  const hd = Math.max(1, stats.hitDice);
  const warnings: string[] = [];

  const rows: SkillRow[] = [...names].map((name) => {
    const def = skillDef(name) ?? null;
    const file = fileRanks.get(name);
    const o = overrides[name] ?? overrideByLower.get(name.toLowerCase());
    const ranks = o?.ranks ?? file?.ranks ?? 0;
    const classSkill = o?.classSkill ?? file?.classSkill ?? false;
    const ability = def?.ability ?? null;
    const mods: Modifier[] = [];
    if (ranks) mods.push({ value: ranks, type: 'base', source: 'Ranks' });
    if (classSkill && ranks >= 1) mods.push({ value: 3, type: 'untyped', source: 'Class skill' });
    if (ability) mods.push({ value: stats.abilities[ability].mod, type: 'ability', source: ability.charAt(0) + ability.slice(1).toLowerCase() });
    const racial = racialByLower.get(name.toLowerCase())?.bonus ?? (def ? racialByLower.get(def.name.toLowerCase())?.bonus : undefined);
    if (racial) mods.push({ value: racial, type: 'racial', source: c.build.attributes.race ?? 'Race' });
    const normName = normalizeName(name);
    const appliedFeats = new Set<string>();
    for (const f of feats) {
      if (f.key === 'skillfocus' && !appliedFeats.has('skillfocus') && f.targets.some((t) => normalizeName(t) === normName)) {
        appliedFeats.add('skillfocus');
        mods.push({ value: ranks >= 10 ? 6 : 3, type: 'untyped', source: 'Skill Focus' });
      }
      const pair = PAIR_FEATS[f.key];
      if (pair && !appliedFeats.has(f.key) && pair.includes(def?.name ?? name)) {
        appliedFeats.add(f.key);
        mods.push({ value: ranks >= 10 ? 4 : 2, type: 'untyped', source: f.name.replace(/\s*\(.*\)$/, '') });
      }
    }
    mods.push(...classSkillBonuses(c, name));
    if (def?.name === 'Stealth' && STEALTH_SIZE[stats.size]) mods.push({ value: STEALTH_SIZE[stats.size], type: 'size', source: stats.size });
    if (def?.name === 'Fly' && FLY_SIZE[stats.size]) mods.push({ value: FLY_SIZE[stats.size], type: 'size', source: stats.size });
    if (def?.acp && stats.armor.acp) mods.push({ value: stats.armor.acp, type: 'untyped', source: 'Armor check penalty' });
    if (o?.misc) mods.push({ value: o.misc, type: 'untyped', source: 'Misc (sheet)' });

    const trainedOnly = def?.trainedOnly ?? false;
    const usable = !trainedOnly || ranks > 0 || (bardic && def?.name === 'Knowledge');
    if (ranks > hd) warnings.push(`${name}: ${ranks} ranks is more than your ${hd} hit dice allow.`);
    if (!def) warnings.push(`${name}: unknown skill, add its bonus under Misc.`);
    return {
      name,
      def,
      ability,
      ranks,
      fileRanks: file?.ranks ?? 0,
      classSkill,
      trainedOnly,
      usable,
      favorite: o?.favorite ?? false,
      custom: o?.custom ?? false,
      total: sumModifiers(mods),
      override: o,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, totalRanks: rows.reduce((sum, r) => sum + r.ranks, 0), maxRanks: hd, warnings };
}

// ------------------------------------------------------------------ situational modifiers

export interface Situational {
  id: string;
  label: string;
  /** Flat bonus, or dice like "1d6". */
  bonus: number | string;
  /** Class action spent when used (e.g. Investigator inspiration); null = free this time. */
  spendActionId: string | null;
}

/** Optional bonuses that apply only sometimes, offered as toggles before a roll. */
export function situationalFor(c: Character, stats: CharacterStats, row: SkillRow): Situational[] {
  const out: Situational[] = [];
  const name = row.def?.name ?? row.name;
  const trap = classLevel(c, 'rogue', 'rogueunchained', 'unchainedrogue', 'investigator');
  if (trap && (name === 'Perception' || name === 'Disable Device')) {
    out.push({ id: 'trapfinding', label: 'Trapfinding (traps)', bonus: halfLevel(trap), spendActionId: null });
  }
  const alchemist = classLevel(c, 'alchemist');
  if (alchemist && row.name.toLowerCase() === 'craft (alchemy)') {
    out.push({ id: 'alchemy', label: 'Alchemy (creating an alchemical item)', bonus: alchemist, spendActionId: null });
  }
  const hunterLvl = classLevel(c, 'hunter');
  // Hunter gains Track at 2nd level; Ranger and Slayer gain it at 1st.
  const tracker = classLevel(c, 'ranger', 'slayer') + (hunterLvl >= 2 ? hunterLvl : 0);
  if (tracker && name === 'Survival') out.push({ id: 'track', label: 'Track (following tracks)', bonus: halfLevel(tracker), spendActionId: null });
  if (classLevel(c, 'inquisitor') && name === 'Knowledge' && stats.abilities.WIS.mod > 0) {
    out.push({ id: 'monsterlore', label: 'Monster lore (identify creatures)', bonus: stats.abilities.WIS.mod, spendActionId: null });
  }
  if (classLevel(c, 'investigator')) {
    const free = row.ranks > 0 && (name === 'Knowledge' || name === 'Linguistics' || name === 'Spellcraft');
    out.push({ id: 'inspiration', label: free ? 'Inspiration (free: trained)' : 'Inspiration (1 point)', bonus: '1d6', spendActionId: free ? null : 'c.investigator.inspire' });
  }
  if (/dwarf|duergar/i.test(c.build.attributes.race ?? '') && name === 'Perception') {
    out.push({ id: 'stonecunning', label: 'Stonecunning (unusual stonework)', bonus: 2, spendActionId: null });
  }
  return out;
}

/** Roll expression for a check with situational extras, e.g. "1d20+7+1d6". */
export function skillRollExpression(total: number, extras: (number | string)[], take?: 10 | 20): string {
  let expr = take ? String(take) : '1d20';
  let flat = total;
  for (const e of extras) {
    if (typeof e === 'number') flat += e;
    else expr += `+${e}`;
  }
  flat = Math.trunc(flat);
  if (flat) expr += flat > 0 ? `+${flat}` : `${flat}`;
  return expr;
}
