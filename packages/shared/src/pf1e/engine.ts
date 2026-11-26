/**
 * PF1e core stat engine: derives the numbers on the character sheet from the
 * imported PCGen build, the rules tables, sheet overrides and runtime state.
 * Pure and deterministic, shared by client (sheet) and server (token sync).
 */
import type { Character } from '../entities/pf1e';
import { sumModifiers, type Modifier, type StatLine } from './modifiers';
import {
  babFor,
  baseSaveFor,
  FEAT_FLAGS,
  featKey,
  lookupArmor,
  lookupClass,
  lookupFeatEffects,
  lookupRace,
  SIZE_MOD,
  SPECIAL_SIZE_MOD,
  STAT_KEYS,
  type ArmorData,
  type ClassChassis,
  type FeatTarget,
  type SaveKey,
  type SizeName,
  type StatKey,
} from './rules';

export interface AbilityScore {
  key: StatKey;
  /** Score after racial, level-up, temp and drain adjustments. */
  score: number;
  damage: number;
  /** Modifier, including ability damage. */
  mod: number;
  line: StatLine;
}

export interface ClassInfo {
  name: string;
  level: number;
  chassis: ClassChassis | null;
  /** Where the chassis came from. */
  chassisSource: 'rules' | 'sheet' | 'missing';
}

export interface CharacterStats {
  abilities: Record<StatKey, AbilityScore>;
  hitDice: number;
  classes: ClassInfo[];
  hp: StatLine;
  bab: StatLine;
  saves: Record<SaveKey, StatLine>;
  ac: { normal: StatLine; touch: StatLine; flatFooted: StatLine };
  cmb: StatLine;
  cmd: StatLine;
  initiative: StatLine;
  size: SizeName;
  speed: StatLine;
  senses: { darkvision: number; lowLight: boolean };
  armor: { worn: string[]; maxDex: number | null; acp: number; heavyArmor: boolean };
  /** Things the user should fill in on the sheet for accurate numbers. */
  warnings: string[];
}

const ABILITY_FOR_SAVE: Record<SaveKey, StatKey> = { fort: 'CON', ref: 'DEX', will: 'WIS' };
const SAVE_NAMES: Record<SaveKey, string> = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
export const saveName = (k: SaveKey) => SAVE_NAMES[k];

/** Names of every feat/trait/ability the character has (for rule lookups). */
function abilityNames(c: Character): string[] {
  return [...c.build.abilities.map((a) => a.key), ...c.build.legacyFeats, ...c.build.virtualFeats];
}

/** Armor and shields worn directly in the active equipment set (not stowed in a container). */
function wornArmor(c: Character): { name: string; armor: ArmorData; enhancement: number }[] {
  const set = c.build.equipmentSets.find((s) => s.id === c.build.activeEquipmentSetId) ?? c.build.equipmentSets[0];
  const names = set
    ? set.items.filter((i) => i.parentId === set.id && i.itemName).map((i) => i.itemName!)
    : c.build.equipment.map((e) => e.name);
  return names.flatMap((name) => {
    const hit = lookupArmor(name);
    return hit ? [{ name, ...hit }] : [];
  });
}

export function computeCharacterStats(c: Character): CharacterStats {
  const { build, sheet, runtime } = c;
  const warnings: string[] = [];
  const race = lookupRace(build.attributes.race);
  if (build.attributes.race && !race) warnings.push(`Unknown race "${build.attributes.race}": set size, speed and senses in Sheet settings.`);
  const names = abilityNames(c);
  const has = (key: string) => names.some((n) => featKey(n) === key);

  // ---------------------------------------------------------------- abilities
  const levelUps: Partial<Record<StatKey, number>> = {};
  for (const lvl of build.classLevels) {
    for (const [k, v] of Object.entries(lvl.statIncreases)) {
      const key = k.toUpperCase() as StatKey;
      if (STAT_KEYS.includes(key)) levelUps[key] = (levelUps[key] ?? 0) + v;
    }
  }
  if (race?.anyPlusTwo && !sheet.racialChoice) warnings.push(`${build.attributes.race}: choose which ability gets the racial +2 in Sheet settings.`);

  const abilities = {} as Record<StatKey, AbilityScore>;
  for (const key of STAT_KEYS) {
    const mods: Modifier[] = [{ value: build.attributes.stats[key] ?? 10, type: 'base', source: 'Base' }];
    const racial = race?.anyPlusTwo ? (sheet.racialChoice === key ? 2 : 0) : (race?.stats[key] ?? 0);
    if (racial) mods.push({ value: racial, type: 'racial', source: build.attributes.race ?? 'Race' });
    if (levelUps[key]) mods.push({ value: levelUps[key]!, type: 'untyped', source: 'Level-up increases' });
    if (runtime.abilityTemp[key]) mods.push({ value: runtime.abilityTemp[key]!, type: 'untyped', source: 'Temporary' });
    if (runtime.abilityDrain[key]) mods.push({ value: -runtime.abilityDrain[key]!, type: 'untyped', source: 'Drain' });
    const line = sumModifiers(mods);
    const damage = runtime.abilityDamage[key] ?? 0;
    abilities[key] = { key, score: line.total, damage, mod: Math.floor((line.total - damage - 10) / 2), line };
  }
  const mod = (k: StatKey) => abilities[k].mod;

  // ---------------------------------------------------------------- classes, BAB, saves
  const classes: ClassInfo[] = build.classes.map((k) => {
    const fromSheet = sheet.classChassis[k.name];
    const fromRules = lookupClass(k.name);
    const chassis = fromSheet ?? fromRules ?? null;
    if (!chassis) warnings.push(`Unknown class "${k.name}": set its hit die, BAB and good saves in Sheet settings.`);
    return { name: k.name, level: k.level, chassis, chassisSource: fromSheet ? 'sheet' : fromRules ? 'rules' : 'missing' };
  });
  const hitDice = classes.reduce((s, k) => s + k.level, 0);

  const bab = sumModifiers(
    classes.map((k) => ({ value: k.chassis ? babFor(k.chassis.bab, k.level) : 0, type: 'base' as const, source: `${k.name} ${k.level}` })),
  );

  // Feat/trait effects and sheet misc values, collected per target.
  const extra: Record<FeatTarget, Modifier[]> = { hp: [], initiative: [], fort: [], ref: [], will: [], ac: [], cmd: [], speed: [] };
  for (const n of names) {
    for (const e of lookupFeatEffects(n) ?? []) {
      extra[e.target].push({ value: typeof e.value === 'function' ? e.value(hitDice) : e.value, type: e.type, source: n.replace(/^trait\s*~\s*/i, '') });
    }
  }
  const misc = (k: keyof typeof sheet.misc, source = 'Misc (sheet)'): Modifier[] =>
    sheet.misc[k] ? [{ value: sheet.misc[k]!, type: 'untyped', source }] : [];

  const saves = {} as Record<SaveKey, StatLine>;
  for (const s of ['fort', 'ref', 'will'] as SaveKey[]) {
    saves[s] = sumModifiers([
      ...classes.map((k) => ({
        value: k.chassis ? baseSaveFor(k.chassis.goodSaves.includes(s), k.level, k.chassis.prestige) : 0,
        type: 'base' as const,
        source: `${k.name} ${k.level}`,
      })),
      { value: mod(ABILITY_FOR_SAVE[s]), type: 'ability', source: ABILITY_FOR_SAVE[s].charAt(0) + ABILITY_FOR_SAVE[s].slice(1).toLowerCase() },
      ...extra[s],
      ...misc(s),
    ]);
  }

  // ---------------------------------------------------------------- HP
  const rolled = build.classLevels.reduce((s, l) => s + (l.hitPoints ?? 0), 0);
  const missingRolls = build.classLevels.filter((l) => l.hitPoints === null).length;
  if (missingRolls) warnings.push(`${missingRolls} level(s) have no HP roll in the .pcg file; add them as Misc HP.`);
  const hp = sumModifiers([
    { value: rolled, type: 'base', source: 'Rolled hit dice' },
    { value: mod('CON') * hitDice, type: 'ability', source: `Con × ${hitDice} HD` },
    ...extra.hp,
    ...misc('hp', 'Misc (favored class etc.)'),
  ]);

  // ---------------------------------------------------------------- size, armor, AC
  const size: SizeName = sheet.size ?? race?.size ?? 'Medium';
  const worn = wornArmor(c);
  const armorItem = worn.find((w) => w.armor.kind === 'armor');
  const shieldItem = worn.find((w) => w.armor.kind === 'shield');
  const armorBonus = sheet.armorBonus ?? (armorItem ? armorItem.armor.bonus + armorItem.enhancement : 0);
  const shieldBonus = sheet.shieldBonus ?? (shieldItem ? shieldItem.armor.bonus + shieldItem.enhancement : 0);
  const caps = worn.map((w) => w.armor.maxDex).filter((m): m is number => m !== null);
  const maxDex = sheet.maxDex ?? (caps.length ? Math.min(...caps) : null);
  const dexToAc = maxDex === null ? mod('DEX') : Math.min(mod('DEX'), maxDex);
  const heavyArmor = !!armorItem && (armorItem.armor.category === 'medium' || armorItem.armor.category === 'heavy');

  const acDex: Modifier = { value: dexToAc, type: 'ability', source: maxDex !== null && mod('DEX') > maxDex ? `Dex (max ${maxDex})` : 'Dex' };
  const acArmor: Modifier = { value: armorBonus, type: 'armor', source: sheet.armorBonus !== null ? 'Armor (sheet)' : (armorItem?.name ?? 'Armor') };
  const acShield: Modifier = { value: shieldBonus, type: 'shield', source: sheet.shieldBonus !== null ? 'Shield (sheet)' : (shieldItem?.name ?? 'Shield') };
  const acSize: Modifier = { value: SIZE_MOD[size], type: 'size', source: size };
  const acNatural: Modifier[] = sheet.misc.natural ? [{ value: sheet.misc.natural, type: 'natural', source: 'Natural armor' }] : [];
  const acDeflection: Modifier[] = sheet.misc.deflection ? [{ value: sheet.misc.deflection, type: 'deflection', source: 'Deflection' }] : [];
  const dodge = extra.ac.filter((m) => m.type === 'dodge');
  const otherAc = [...extra.ac.filter((m) => m.type !== 'dodge'), ...misc('ac')];
  const base10: Modifier = { value: 10, type: 'base', source: 'Base' };

  const ac = {
    normal: sumModifiers([base10, acArmor, acShield, acDex, acSize, ...acNatural, ...acDeflection, ...dodge, ...otherAc]),
    touch: sumModifiers([base10, acDex, acSize, ...acDeflection, ...dodge, ...otherAc]),
    flatFooted: sumModifiers([base10, acArmor, acShield, ...(dexToAc < 0 ? [acDex] : []), acSize, ...acNatural, ...acDeflection, ...otherAc]),
  };

  // ---------------------------------------------------------------- CMB / CMD / initiative / speed
  const agile = has(FEAT_FLAGS.agileManeuvers) || SIZE_MOD[size] >= SIZE_MOD.Tiny;
  const cmbAbility: StatKey = agile && mod('DEX') > mod('STR') ? 'DEX' : 'STR';
  const specialSize: Modifier = { value: SPECIAL_SIZE_MOD[size], type: 'size', source: size };
  const cmb = sumModifiers([
    { value: bab.total, type: 'base', source: 'BAB' },
    { value: mod(cmbAbility), type: 'ability', source: cmbAbility === 'DEX' ? 'Dex (Agile Maneuvers)' : 'Str' },
    specialSize,
    ...misc('cmb'),
  ]);
  const dctBab = has(FEAT_FLAGS.defensiveCombatTraining) ? Math.max(bab.total, hitDice) : bab.total;
  const cmd = sumModifiers([
    { value: 10, type: 'base', source: 'Base' },
    { value: dctBab, type: 'base', source: dctBab !== bab.total ? 'Hit dice (Defensive Combat Training)' : 'BAB' },
    { value: mod('STR'), type: 'ability', source: 'Str' },
    { value: mod('DEX'), type: 'ability', source: 'Dex' },
    specialSize,
    ...acDeflection,
    ...extra.cmd,
    ...misc('cmd'),
  ]);
  const initiative = sumModifiers([{ value: mod('DEX'), type: 'ability', source: 'Dex' }, ...extra.initiative, ...misc('initiative')]);

  const baseSpeed = sheet.speed ?? race?.speed ?? 30;
  const armorSlows = heavyArmor && !race?.steady && sheet.speed === null;
  const speed = sumModifiers([
    { value: armorSlows ? (baseSpeed >= 30 ? Math.round((baseSpeed * 2) / 3 / 5) * 5 : baseSpeed - 5) : baseSpeed, type: 'base', source: armorSlows ? `Base ${baseSpeed} ft, in ${armorItem!.armor.category} armor` : 'Base' },
    ...extra.speed,
  ]);

  return {
    abilities,
    hitDice,
    classes,
    hp,
    bab,
    saves,
    ac,
    cmb,
    cmd,
    initiative,
    size,
    speed,
    senses: { darkvision: sheet.darkvision ?? race?.darkvision ?? 0, lowLight: race?.lowLight ?? false },
    armor: { worn: worn.map((w) => w.name), maxDex, acp: worn.reduce((s, w) => s + w.armor.acp, 0), heavyArmor },
    warnings,
  };
}
