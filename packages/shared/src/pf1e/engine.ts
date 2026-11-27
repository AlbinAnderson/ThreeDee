/**
 * PF1e core stat engine: derives the numbers on the character sheet from the
 * imported PCGen build, the rules tables, sheet overrides and runtime state.
 * Pure and deterministic, shared by client (sheet) and server (token sync).
 */
import type { Character, ItemArmor, RulesBonusTarget } from '../entities/pf1e';
import { carryingCapacity, sizedDamage, weaponKey, type CarryingCapacity } from './gear';
import { activeLoadout, carriedWeight, equippedItemBonuses, itemsInSlot, type LoadWeight } from './inventory';
import { sumModifiers, type Modifier, type StatLine } from './modifiers';
import { acrobaticsRanks, activeToggles, toggleStep, type ToggleId } from './toggles';
import { characterEffects, CMD_FROM_AC, NOT_TOUCH, type EffectSource } from './buffs';
import {
  babFor,
  baseSaveFor,
  FEAT_FLAGS,
  featKey,
  lookupClass,
  lookupFeatEffects,
  lookupRace,
  normalizeName,
  raceDataFromSnapshot,
  SIZE_MOD,
  SIZES,
  SPECIAL_SIZE_MOD,
  STAT_KEYS,
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
  armor: {
    worn: string[];
    /** Effective max Dex to AC from armor, shield and load; null = no cap. */
    maxDex: number | null;
    /** Effective armor check penalty (worse of armor+shield and load). */
    acp: number;
    /** Arcane spell failure chance, percent. */
    asf: number;
    heavyArmor: boolean;
  };
  load: { weight: LoadWeight; capacity: CarryingCapacity; level: LoadLevel };
  attacks: WeaponAttack[];
  /** Active combat toggles (see pf1e/toggles.ts); total defense means no attacks this round. */
  toggles: ToggleId[];
  /** Full-attack bonuses when fighting with a weapon in each hand. */
  twoWeapon: { primary: number[]; offHand: number[]; primaryName: string; offHandName: string } | null;
  /** Active buffs and conditions (Epic 8), with reminders for what the numbers don't cover. */
  effects: {
    sources: EffectSource[];
    notes: string[];
    /** Lost Dex bonus to AC (blinded, stunned, flat-footed...). */
    loseDexToAc: boolean;
    /** Typed bonuses/penalties on every skill check, and on caster level. */
    skills: Modifier[];
    casterLevel: Modifier[];
  };
  /** Things the user should fill in on the sheet for accurate numbers. */
  warnings: string[];
}

export type LoadLevel = 'light' | 'medium' | 'heavy' | 'overloaded';

/** Max Dex and check penalty from load (Core Rulebook Table 7-5). */
const LOAD_EFFECTS: Record<LoadLevel, { maxDex: number | null; acp: number }> = {
  light: { maxDex: null, acp: 0 },
  medium: { maxDex: 3, acp: -3 },
  heavy: { maxDex: 1, acp: -6 },
  overloaded: { maxDex: 0, acp: -6 },
};

export interface WeaponAttack {
  itemId: string;
  name: string;
  mode: 'melee' | 'thrown' | 'ranged';
  hand: 'primary' | 'offHand' | 'bothHands';
  /** One attack (a standard action). */
  attack: StatLine;
  /** Full attack (iterative attacks at -5 each). */
  fullAttack: number[];
  /** Dice sized for the wielder, e.g. "1d6". */
  dice: string;
  damage: StatLine;
  /** "19-20/×2" */
  crit: string;
  /** Range increment in feet; 0 = none. */
  range: number;
}

const ABILITY_FOR_SAVE: Record<SaveKey, StatKey> = { fort: 'CON', ref: 'DEX', will: 'WIS' };
const SAVE_NAMES: Record<SaveKey, string> = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
export const saveName = (k: SaveKey) => SAVE_NAMES[k];

/** Names of every feat/trait/ability the character has (for rule lookups). */
function abilityNames(c: Character): string[] {
  return [...c.build.abilities.map((a) => a.key), ...c.build.legacyFeats, ...c.build.virtualFeats];
}

/** Armor in the armor slot and shields in the shield slot of the active loadout. */
function wornArmor(c: Character): { name: string; armor: ItemArmor }[] {
  const inv = c.inventory;
  const loadout = activeLoadout(inv);
  return [
    ...itemsInSlot(inv, loadout, 'armor').filter((i) => i.armor?.kind === 'armor'),
    ...itemsInSlot(inv, loadout, 'shield').filter((i) => i.armor?.kind === 'shield'),
  ].map((i) => ({ name: i.name, armor: i.armor! }));
}

const critText = (range: number, mult: number) => `${range < 20 ? `${range}-20/` : ''}×${mult}`;

function iteratives(bab: number, total: number): number[] {
  const out = [total];
  for (let k = 1; k < 4 && bab - 5 * k >= 1; k++) out.push(total - 5 * k);
  return out;
}

export function computeCharacterStats(c: Character): CharacterStats {
  const { build, sheet, runtime } = c;
  const warnings: string[] = [];
  const race = lookupRace(build.attributes.race) ?? raceDataFromSnapshot(c.rulesData.race);
  if (build.attributes.race && !race) warnings.push(`Unknown race "${build.attributes.race}": set size, speed and senses in Sheet settings.`);
  const names = abilityNames(c);
  const has = (key: string) => names.some((n) => featKey(n) === key);
  // Buffs and conditions: typed modifiers per target (Epic 8).
  const fx = characterEffects(c);

  // Passive static bonuses from snapshotted PCGen feats/traits/abilities and currently equipped magic items (Epic 13).
  const passive: Record<Exclude<RulesBonusTarget, 'skill'>, Modifier[]> = {
    STR: [],
    DEX: [],
    CON: [],
    INT: [],
    WIS: [],
    CHA: [],
    ac: [],
    initiative: [],
    attack: [],
    attackMelee: [],
    attackRanged: [],
    damage: [],
    damageMelee: [],
    damageRanged: [],
    fort: [],
    ref: [],
    will: [],
    saves: [],
    speed: [],
    hp: [],
  };
  for (const b of c.rulesData.bonuses) {
    if (b.target !== 'skill') passive[b.target].push({ value: b.value, type: b.type, source: b.source });
  }
  for (const { item, bonus } of equippedItemBonuses(c)) {
    if (bonus.target !== 'skill') passive[bonus.target].push({ value: bonus.value, type: bonus.type, source: item.name });
  }

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
    mods.push(...passive[key], ...fx.mods[key]);
    let line = sumModifiers(mods);
    // Helpless / paralyzed: the ability counts as a score of 0 (effective modifier −5).
    const zeroed = fx.zero.includes(key);
    if (zeroed && line.total !== 0) line = sumModifiers([...mods, { value: -line.total, type: 'untyped', source: 'Helpless (score 0)' }]);
    const damage = Math.max(0, runtime.abilityDamage[key] ?? 0);
    // PF1e: every 2 points of ability damage apply a -1 penalty without altering the score.
    const abilityMod = zeroed ? -5 : Math.floor((line.total - 10) / 2) - Math.floor(damage / 2);
    abilities[key] = { key, score: line.total, damage, mod: abilityMod, line };
  }
  const mod = (k: StatKey) => abilities[k].mod;

  // ---------------------------------------------------------------- classes, BAB, saves
  const classes: ClassInfo[] = build.classes.map((k) => {
    const fromSheet = sheet.classChassis[k.name];
    const fromRules = lookupClass(k.name) ?? c.rulesData.classes[normalizeName(k.name)];
    const chassis = fromSheet ?? fromRules ?? null;
    if (!chassis) warnings.push(`Unknown class "${k.name}": set its hit die, BAB and good saves in Sheet settings.`);
    return { name: k.name, level: k.level, chassis, chassisSource: fromSheet ? 'sheet' : fromRules ? 'rules' : 'missing' };
  });
  const hitDice = classes.reduce((s, k) => s + k.level, 0);

  const bab = sumModifiers(
    classes.map((k) => ({ value: k.chassis ? babFor(k.chassis.bab, k.level) : 0, type: 'base' as const, source: `${k.name} ${k.level}` })),
  );

  // Determine worn armor up front so light-armor-only feats (e.g. Fleet) know whether they apply.
  // Enlarge/reduce effects move the size category (clamped to Fine..Colossal).
  // PF1e: multiple magical size increases (or decreases) don't stack; take the largest of each direction.
  const baseSize: SizeName = sheet.size ?? race?.size ?? 'Medium';
  const maxGrow = fx.mods.sizeSteps.reduce((m, x) => (x.value > m ? x.value : m), 0);
  const maxShrink = fx.mods.sizeSteps.reduce((m, x) => (x.value < m ? x.value : m), 0);
  const sizeSteps = maxGrow + maxShrink;
  const size: SizeName = SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(baseSize) + sizeSteps))]!;
  const worn = wornArmor(c);
  const effectiveWorn = worn.filter((w) => (w.armor.kind === 'armor' ? sheet.armorBonus !== 0 : sheet.shieldBonus !== 0));
  const armorItem = effectiveWorn
    .filter((w) => w.armor.kind === 'armor')
    .sort((a, b) => b.armor.bonus + b.armor.enhancement - (a.armor.bonus + a.armor.enhancement))[0];
  const shieldItem = effectiveWorn
    .filter((w) => w.armor.kind === 'shield')
    .sort((a, b) => b.armor.bonus + b.armor.enhancement - (a.armor.bonus + a.armor.enhancement))[0];
  const heavyArmor = !!armorItem && (armorItem.armor.category === 'medium' || armorItem.armor.category === 'heavy');

  // Load: carried weight against carrying capacity by Str score and size.
  const weight = carriedWeight(c.inventory);
  const capacity = carryingCapacity(abilities.STR.score, size);
  const loadLevel: LoadLevel =
    weight.total <= capacity.light ? 'light' : weight.total <= capacity.medium ? 'medium' : weight.total <= capacity.heavy ? 'heavy' : 'overloaded';
  const heavyLoad = loadLevel !== 'light';

  // Feat/trait effects and sheet misc values, collected per target (dedup non-stackable feats).
  const extra: Record<FeatTarget, Modifier[]> = { hp: [], initiative: [], fort: [], ref: [], will: [], ac: [], cmd: [], speed: [] };
  const appliedFeats = new Set<string>();
  for (const n of names) {
    const fk = featKey(n);
    const effects = lookupFeatEffects(n);
    if (!effects) continue;
    const stackable = effects.some((e) => e.stackable);
    if (!stackable && appliedFeats.has(fk)) continue;
    appliedFeats.add(fk);
    for (const e of effects) {
      if (e.lightArmorOnly && (heavyArmor || heavyLoad)) continue;
      extra[e.target].push({ value: typeof e.value === 'function' ? e.value(hitDice) : e.value, type: e.type, source: n.replace(/^trait\s*~\s*/i, '') });
    }
  }
  const misc = (k: keyof typeof sheet.misc, source = 'Misc (sheet)'): Modifier[] =>
    sheet.misc[k] ? [{ value: sheet.misc[k]!, type: 'untyped', source }] : [];

  // Weapon feats chosen for a weapon: Weapon Focus / Specialization (and Greater) with their targets.
  const weaponFeats = new Map<string, Set<string>>();
  const addWeaponFeat = (name: string, targets: string[]) => {
    const k = featKey(name);
    if (!['weaponfocus', 'greaterweaponfocus', 'weaponspecialization', 'greaterweaponspecialization'].includes(k)) return;
    let set = weaponFeats.get(k);
    if (!set) {
      set = new Set();
      weaponFeats.set(k, set);
    }
    for (const t of targets) {
      const wk = weaponKey(t);
      if (wk) set.add(wk);
    }
  };
  for (const a of build.abilities) addWeaponFeat(a.key, a.appliedTo);
  for (const f of [...build.legacyFeats, ...build.virtualFeats]) {
    const m = /\((.+)\)\s*$/.exec(f);
    if (m) addWeaponFeat(f, m[1]!.split(','));
  }
  const hasWeaponFeat = (k: string, itemName: string) => {
    const wk = weaponKey(itemName);
    return !!wk && (weaponFeats.get(k)?.has(wk) ?? false);
  };

  // Combat toggles: dodge bonuses to AC (and CMD, which dodge bonuses also raise).
  const toggles = activeToggles(c);
  const step = toggleStep(bab.total);
  const acro3 = acrobaticsRanks(c) >= 3;
  const dodgeToggle = (value: number, source: string) => {
    extra.ac.push({ value, type: 'dodge', source });
    extra.cmd.push({ value, type: 'dodge', source });
  };
  if (toggles.has('combatExpertise')) dodgeToggle(step, 'Combat Expertise');
  if (toggles.has('fightDefensively')) dodgeToggle(acro3 ? 3 : 2, 'Fighting defensively');
  if (toggles.has('totalDefense')) dodgeToggle(acro3 ? 6 : 4, 'Total defense');

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
      ...passive.saves,
      ...passive[s],
      ...fx.mods.saves,
      ...fx.mods[s],
      ...misc(s),
    ]);
  }

  // ---------------------------------------------------------------- HP
  const rolled = build.classLevels.reduce((s, l) => s + (l.hitPoints ?? 0), 0);
  const missingRolls = build.classLevels.filter((l) => l.hitPoints === null).length;
  if (missingRolls) warnings.push(`${missingRolls} level(s) have no HP roll in the .pcg file; add them as Misc HP.`);
  // PF1e: each hit die grants at least 1 HP even with a negative Con modifier.
  const conMod = mod('CON');
  let conHpTotal = conMod * hitDice;
  if (conMod < 0 && build.classLevels.length > 0) {
    let adjusted = 0;
    let rolledCount = 0;
    for (const l of build.classLevels) {
      if (l.hitPoints !== null) {
        adjusted += Math.max(1, l.hitPoints + conMod) - l.hitPoints;
        rolledCount++;
      }
    }
    conHpTotal = adjusted + conMod * Math.max(0, hitDice - rolledCount);
  }
  const hp = sumModifiers([
    { value: rolled, type: 'base', source: 'Rolled hit dice' },
    { value: conHpTotal, type: 'ability', source: `Con × ${hitDice} HD` },
    ...extra.hp,
    ...passive.hp,
    ...misc('hp', 'Misc (favored class etc.)'),
  ]);

  // ---------------------------------------------------------------- size, armor, AC
  const armorBonus = sheet.armorBonus ?? (armorItem ? armorItem.armor.bonus + armorItem.armor.enhancement : 0);
  const shieldBonus = sheet.shieldBonus ?? (shieldItem ? shieldItem.armor.bonus + shieldItem.armor.enhancement : 0);
  const loadFx = LOAD_EFFECTS[loadLevel];
  // Armor and load don't stack: the worse cap and the worse penalty apply.
  const caps = [...effectiveWorn.map((w) => w.armor.maxDex), loadFx.maxDex].filter((m): m is number => m !== null);
  const maxDex = sheet.maxDex ?? (caps.length ? Math.min(...caps) : null);
  const loadCapsDex = sheet.maxDex === null && loadFx.maxDex !== null && loadFx.maxDex === maxDex;
  const dexToAc = maxDex === null ? mod('DEX') : Math.min(mod('DEX'), maxDex);
  const armorAcp = effectiveWorn.reduce((s, w) => s + w.armor.acp, 0);
  const acp = Math.min(armorAcp, loadFx.acp);
  const asf = Math.min(100, effectiveWorn.reduce((s, w) => s + w.armor.asf, 0));

  const acDex: Modifier = {
    value: dexToAc,
    type: 'ability',
    source: maxDex !== null && mod('DEX') > maxDex ? `Dex (max ${maxDex}${loadCapsDex ? `, ${loadLevel} load` : ''})` : 'Dex',
  };
  const acArmor: Modifier = { value: armorBonus, type: 'armor', source: sheet.armorBonus !== null ? 'Armor (sheet)' : (armorItem?.name ?? 'Armor') };
  const acShield: Modifier = { value: shieldBonus, type: 'shield', source: sheet.shieldBonus !== null ? 'Shield (sheet)' : (shieldItem?.name ?? 'Shield') };
  const acSize: Modifier = { value: SIZE_MOD[size], type: 'size', source: size };
  const acNatural: Modifier[] = sheet.misc.natural ? [{ value: sheet.misc.natural, type: 'natural', source: 'Natural armor' }] : [];
  const acDeflection: Modifier[] = sheet.misc.deflection ? [{ value: sheet.misc.deflection, type: 'deflection', source: 'Deflection' }] : [];
  // Buff & passive AC: dodge joins the other dodge bonuses; armor/shield/natural/enhancement types stay off touch AC and CMD.
  const loseDex = fx.loseDexToAc;
  const typedAcMods = [...fx.mods.ac, ...passive.ac];
  const dodge = [...extra.ac, ...typedAcMods].filter((m) => m.type === 'dodge');
  const otherAc = [...extra.ac.filter((m) => m.type !== 'dodge'), ...misc('ac'), ...typedAcMods.filter((m) => m.type !== 'dodge' && !NOT_TOUCH.has(m.type))];
  const buffArmorAc = typedAcMods.filter((m) => NOT_TOUCH.has(m.type));
  // Losing the Dex bonus to AC (blinded, stunned...) drops a positive Dex modifier and every dodge bonus.
  const dexAcParts = loseDex ? (dexToAc < 0 ? [acDex] : []) : [acDex];
  const dodgeParts = loseDex ? [] : dodge;
  const base10: Modifier = { value: 10, type: 'base', source: 'Base' };

  const ac = {
    normal: sumModifiers([base10, acArmor, acShield, ...dexAcParts, acSize, ...acNatural, ...acDeflection, ...dodgeParts, ...otherAc, ...buffArmorAc]),
    touch: sumModifiers([base10, ...dexAcParts, acSize, ...acDeflection, ...dodgeParts, ...otherAc]),
    flatFooted: sumModifiers([base10, acArmor, acShield, ...(dexToAc < 0 ? [acDex] : []), acSize, ...acNatural, ...acDeflection, ...otherAc, ...buffArmorAc]),
  };

  // ---------------------------------------------------------------- CMB / CMD / initiative / speed
  const isTinyOrSmaller = SIZE_MOD[size] >= SIZE_MOD.Tiny;
  const hasAgile = has(FEAT_FLAGS.agileManeuvers);
  const useDexCmb = isTinyOrSmaller || (hasAgile && mod('DEX') > mod('STR'));
  const cmbAbility: StatKey = useDexCmb ? 'DEX' : 'STR';
  const cmbSource = !useDexCmb ? 'Str' : isTinyOrSmaller ? `Dex (${size})` : 'Dex (Agile Maneuvers)';
  const specialSize: Modifier = { value: SPECIAL_SIZE_MOD[size], type: 'size', source: size };
  const cmbTogglePenalties: Modifier[] = [];
  if (toggles.has('powerAttack')) cmbTogglePenalties.push({ value: -step, type: 'untyped', source: 'Power Attack' });
  if (toggles.has('piranhaStrike')) cmbTogglePenalties.push({ value: -step, type: 'untyped', source: 'Piranha Strike' });
  if (toggles.has('combatExpertise')) cmbTogglePenalties.push({ value: -step, type: 'untyped', source: 'Combat Expertise' });
  if (toggles.has('fightDefensively')) cmbTogglePenalties.push({ value: -4, type: 'untyped', source: 'Fighting defensively' });
  const cmb = sumModifiers([
    { value: bab.total, type: 'base', source: 'BAB' },
    { value: mod(cmbAbility), type: 'ability', source: cmbSource },
    specialSize,
    ...cmbTogglePenalties,
    // Bonuses and penalties on attack rolls from spells, items, feats and conditions apply to combat maneuvers too.
    ...passive.attack,
    ...passive.attackMelee,
    ...fx.mods.attack,
    ...fx.mods.attackMelee,
    ...fx.mods.cmb,
    ...misc('cmb'),
  ]);
  const dctBab = has(FEAT_FLAGS.defensiveCombatTraining) ? Math.max(bab.total, hitDice) : bab.total;
  const cmd = sumModifiers([
    { value: 10, type: 'base', source: 'Base' },
    { value: dctBab, type: 'base', source: dctBab !== bab.total ? 'Hit dice (Defensive Combat Training)' : 'BAB' },
    { value: mod('STR'), type: 'ability', source: 'Str' },
    ...(loseDex && mod('DEX') > 0 ? [] : [{ value: mod('DEX'), type: 'ability' as const, source: 'Dex' }]),
    specialSize,
    ...acDeflection,
    ...extra.cmd.filter((m) => !(loseDex && m.type === 'dodge')),
    // CMD gains the AC bonus types listed in the CMD rules (deflection, dodge, insight, luck, morale, profane, sacred), and every AC penalty.
    ...typedAcMods.filter((m) => m.value < 0 || (CMD_FROM_AC.has(m.type) && !(loseDex && m.type === 'dodge'))),
    ...fx.mods.cmd,
    ...misc('cmd'),
  ]);
  const initiative = sumModifiers([{ value: mod('DEX'), type: 'ability', source: 'Dex' }, ...extra.initiative, ...passive.initiative, ...fx.mods.initiative, ...misc('initiative')]);

  const baseSpeed = sheet.speed ?? race?.speed ?? 30;
  // Steady races (dwarves) aren't slowed by armor or load.
  const armorSlows = heavyArmor && !race?.steady && sheet.speed === null;
  const loadSlows = heavyLoad && !race?.steady && sheet.speed === null;
  // PF1e Table: Armor and Shields — 20->15, 30->20, 40->30, 50->35, 60->40.
  const reducedSpeed = baseSpeed <= 0 ? 0 : Math.max(5, Math.ceil((baseSpeed * 2) / 3 / 5) * 5);
  const why = [armorSlows ? `${armorItem!.armor.category} armor` : null, loadSlows ? `${loadLevel} load` : null].filter(Boolean).join(', ');
  const speedBase: Modifier =
    loadLevel === 'overloaded' && sheet.speed === null
      ? { value: 5, type: 'base', source: 'Overloaded: can only stagger 5 ft' }
      : { value: armorSlows || loadSlows ? reducedSpeed : baseSpeed, type: 'base', source: why ? `Base ${baseSpeed} ft, ${why}` : 'Base' };
  const speed = sumModifiers([speedBase, ...(loadLevel === 'overloaded' ? [] : [...extra.speed, ...passive.speed, ...fx.mods.speed])]);

  // ---------------------------------------------------------------- weapon attacks
  const finesse = has('weaponfinesse');
  const loadout = activeLoadout(c.inventory);
  const wielded = (['primary', 'bothHands', 'offHand'] as const).flatMap((hand) =>
    itemsInSlot(c.inventory, loadout, hand)
      .filter((i) => i.weapon)
      .map((item) => ({ item, weapon: item.weapon!, hand })),
  );
  const attacks: WeaponAttack[] = [];
  for (const { item, weapon, hand } of wielded) {
    const modes: WeaponAttack['mode'][] = weapon.type === 'melee' ? (weapon.range > 0 ? ['melee', 'thrown'] : ['melee']) : [weapon.type];
    for (const mode of modes) {
      const useDex = mode !== 'melee' || (weapon.finesse && finesse && mod('DEX') > mod('STR'));
      const attackAbility: Modifier = {
        value: useDex ? mod('DEX') : mod('STR'),
        type: 'ability',
        source: useDex ? (mode === 'melee' ? 'Dex (Weapon Finesse)' : 'Dex') : 'Str',
      };
      const weaponBonus: Modifier[] = weapon.enhancement
        ? [{ value: weapon.enhancement, type: 'enhancement', source: `+${weapon.enhancement} weapon` }]
        : weapon.masterwork
          ? [{ value: 1, type: 'enhancement', source: 'Masterwork' }]
          : [];
      // Combat toggles: attack penalties and damage bonuses.
      const melee = mode === 'melee';
      // PF1e Piranha Strike applies only to light melee weapons (not one-/two-handed finesse weapons).
      const piranhaOk = melee && weapon.hands === 'light';
      const togglePenalties: Modifier[] = [];
      const toggleDamage: Modifier[] = [];
      const on = (id: ToggleId) => toggles.has(id);
      if (on('powerAttack') && melee) {
        togglePenalties.push({ value: -step, type: 'untyped', source: 'Power Attack' });
        const twoHanded = hand === 'bothHands' && weapon.hands !== 'light';
        toggleDamage.push({ value: hand === 'offHand' ? step : twoHanded ? 3 * step : 2 * step, type: 'untyped', source: 'Power Attack' });
      }
      if (on('piranhaStrike') && piranhaOk) {
        togglePenalties.push({ value: -step, type: 'untyped', source: 'Piranha Strike' });
        toggleDamage.push({ value: hand === 'offHand' ? step : 2 * step, type: 'untyped', source: 'Piranha Strike' });
      }
      if (on('deadlyAim') && !melee) {
        togglePenalties.push({ value: -step, type: 'untyped', source: 'Deadly Aim' });
        toggleDamage.push({ value: 2 * step, type: 'untyped', source: 'Deadly Aim' });
      }
      if (on('combatExpertise') && melee) togglePenalties.push({ value: -step, type: 'untyped', source: 'Combat Expertise' });
      if (on('fightDefensively')) togglePenalties.push({ value: -4, type: 'untyped', source: 'Fighting defensively' });
      const featAttack: Modifier[] = [];
      const featDamage: Modifier[] = [];
      if (hasWeaponFeat('weaponfocus', item.name)) featAttack.push({ value: 1, type: 'untyped', source: 'Weapon Focus' });
      if (hasWeaponFeat('greaterweaponfocus', item.name)) featAttack.push({ value: 1, type: 'untyped', source: 'Greater Weapon Focus' });
      if (hasWeaponFeat('weaponspecialization', item.name)) featDamage.push({ value: 2, type: 'untyped', source: 'Weapon Specialization' });
      if (hasWeaponFeat('greaterweaponspecialization', item.name)) featDamage.push({ value: 2, type: 'untyped', source: 'Greater Weapon Specialization' });

      const attack = sumModifiers([
        { value: bab.total, type: 'base', source: 'BAB' },
        attackAbility,
        { value: SIZE_MOD[size], type: 'size', source: size },
        ...weaponBonus,
        ...featAttack,
        ...togglePenalties,
        ...passive.attack,
        ...(melee ? passive.attackMelee : passive.attackRanged),
        ...fx.mods.attack,
        ...(melee ? fx.mods.attackMelee : fx.mods.attackRanged),
      ]);

      // Strength to damage: x1.5 two-handed (not light weapons), x0.5 off hand; penalties always apply in full.
      const str = mod('STR');
      let strDamage = 0;
      let strSource = 'Str';
      if (mode === 'ranged') {
        if (weapon.strDamage === 'full') strDamage = str;
        else if (weapon.strDamage === 'penalty') strDamage = Math.min(0, str);
      } else if (weapon.strDamage !== 'none') {
        if (str > 0 && mode === 'melee' && hand === 'bothHands' && weapon.hands !== 'light') {
          strDamage = Math.floor(str * 1.5);
          strSource = 'Str ×1.5 (two hands)';
        } else if (str > 0 && hand === 'offHand') {
          strDamage = Math.floor(str / 2);
          strSource = 'Str ×½ (off hand)';
        } else strDamage = str;
      }
      const damage = sumModifiers([
        ...(strDamage ? [{ value: strDamage, type: 'ability' as const, source: strSource }] : []),
        ...(weapon.enhancement ? [{ value: weapon.enhancement, type: 'enhancement' as const, source: `+${weapon.enhancement} weapon` }] : []),
        ...featDamage,
        ...toggleDamage,
        ...passive.damage,
        ...(melee ? passive.damageMelee : passive.damageRanged),
        ...fx.mods.damage,
        ...(melee ? fx.mods.damageMelee : fx.mods.damageRanged),
      ]);
      let fullAttack = mode === 'thrown' ? [attack.total] : iteratives(bab.total, attack.total);
      // Rapid Shot: one extra ranged attack at the highest bonus, every attack at -2.
      if (on('rapidShot') && !melee) fullAttack = [attack.total - 2, ...fullAttack.map((n) => n - 2)];
      // Haste: one extra attack at the highest bonus (several haste effects don't stack).
      if (mode !== 'thrown' && fx.mods.extraAttack.some((m) => m.value > 0)) fullAttack = [fullAttack[0]!, ...fullAttack];
      attacks.push({
        itemId: item.id,
        name: item.name,
        mode,
        hand,
        attack,
        fullAttack,
        dice: sizedDamage(weapon.damage, size),
        damage,
        crit: critText(weapon.critRange, weapon.critMult),
        range: weapon.range,
      });
    }
  }

  // Stat-block attacks (Epic 11 AoN monster imports): fixed bonuses plus active buffs/conditions.
  for (const sa of sheet.statAttacks) {
    const melee = sa.mode === 'melee';
    const baseBonus = sa.bonuses[0] ?? 0;
    const attackMods: Modifier[] = [
      { value: baseBonus, type: 'base', source: 'Stat block' },
      ...fx.mods.attack,
      ...(melee ? fx.mods.attackMelee : fx.mods.attackRanged),
    ];
    const attack = sumModifiers(attackMods);
    const delta = attack.total - baseBonus;
    let fullAttack = sa.bonuses.map((b) => b + delta);
    if (fx.mods.extraAttack.some((m) => m.value > 0)) fullAttack = [fullAttack[0]!, ...fullAttack];
    const damage = sumModifiers([
      ...(sa.damageBonus ? [{ value: sa.damageBonus, type: 'base' as const, source: 'Stat block' }] : []),
      ...fx.mods.damage,
      ...(melee ? fx.mods.damageMelee : fx.mods.damageRanged),
    ]);
    attacks.push({
      itemId: `stat:${sa.id}`,
      name: sa.note ? `${sa.name} (${sa.note})` : sa.name,
      mode: sa.mode,
      hand: 'primary',
      attack,
      fullAttack,
      dice: sa.dice,
      damage,
      crit: critText(sa.critRange, sa.critMult),
      range: 0,
    });
  }

  // Two-weapon fighting: a melee weapon in each hand.
  const main = attacks.find((a) => a.hand === 'primary' && a.mode === 'melee');
  const off = attacks.find((a) => a.hand === 'offHand' && a.mode === 'melee');
  let twoWeapon: CharacterStats['twoWeapon'] = null;
  if (main && off) {
    const offWeapon = wielded.find((x) => x.item.id === off.itemId)!.weapon;
    const light = offWeapon.hands === 'light';
    const twf = has('twoweaponfighting');
    const [pMain, pOff] = twf ? (light ? [-2, -2] : [-4, -4]) : light ? [-4, -8] : [-6, -10];
    const offCount = 1 + (has('improvedtwoweaponfighting') && bab.total >= 6 ? 1 : 0) + (has('greatertwoweaponfighting') && bab.total >= 11 ? 1 : 0);
    twoWeapon = {
      primary: main.fullAttack.map((n) => n + pMain),
      offHand: Array.from({ length: offCount }, (_, k) => off.attack.total + pOff - 5 * k),
      primaryName: main.name,
      offHandName: off.name,
    };
  }

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
    armor: { worn: effectiveWorn.map((w) => w.name), maxDex, acp, asf, heavyArmor },
    load: { weight, capacity, level: loadLevel },
    attacks,
    toggles: [...toggles],
    effects: { sources: fx.sources, notes: fx.notes, loseDexToAc: fx.loseDexToAc, skills: fx.mods.skills, casterLevel: fx.mods.casterLevel },
    twoWeapon,
    warnings,
  };
}
