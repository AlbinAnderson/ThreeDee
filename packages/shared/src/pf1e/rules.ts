/**
 * PF1e reference data the .pcg file doesn't contain: class progressions,
 * races, sizes, armor, and feats/traits with flat numeric effects.
 * Anything missing can be filled in from the character sheet's settings.
 */
import type { BonusType } from './modifiers';

export type StatKey = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
export const STAT_KEYS: StatKey[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
export type SaveKey = 'fort' | 'ref' | 'will';
export type BabProgression = 'full' | 'threeQuarter' | 'half';

/** Normalize names for lookup: "Monk (Unchained)" -> "monkunchained". */
export const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ------------------------------------------------------------------ classes

export interface ClassChassis {
  hd: number;
  bab: BabProgression;
  goodSaves: SaveKey[];
  /** Prestige classes use the prestige save formulas. */
  prestige: boolean;
}

const c = (hd: number, bab: BabProgression, goodSaves: SaveKey[], prestige = false): ClassChassis => ({ hd, bab, goodSaves, prestige });

const CLASSES: Record<string, ClassChassis> = {
  // Core
  barbarian: c(12, 'full', ['fort']),
  bard: c(8, 'threeQuarter', ['ref', 'will']),
  cleric: c(8, 'threeQuarter', ['fort', 'will']),
  druid: c(8, 'threeQuarter', ['fort', 'will']),
  fighter: c(10, 'full', ['fort']),
  monk: c(8, 'threeQuarter', ['fort', 'ref', 'will']),
  paladin: c(10, 'full', ['fort', 'will']),
  ranger: c(10, 'full', ['fort', 'ref']),
  rogue: c(8, 'threeQuarter', ['ref']),
  sorcerer: c(6, 'half', ['will']),
  wizard: c(6, 'half', ['will']),
  // Base & alternate
  alchemist: c(8, 'threeQuarter', ['fort', 'ref']),
  cavalier: c(10, 'full', ['fort']),
  gunslinger: c(10, 'full', ['fort', 'ref']),
  inquisitor: c(8, 'threeQuarter', ['fort', 'will']),
  magus: c(8, 'threeQuarter', ['fort', 'will']),
  oracle: c(8, 'threeQuarter', ['will']),
  summoner: c(8, 'threeQuarter', ['will']),
  witch: c(6, 'half', ['will']),
  antipaladin: c(10, 'full', ['fort', 'will']),
  ninja: c(8, 'threeQuarter', ['ref']),
  samurai: c(10, 'full', ['fort']),
  vigilante: c(8, 'threeQuarter', ['ref', 'will']),
  shifter: c(10, 'full', ['fort', 'ref']),
  // Hybrid
  arcanist: c(6, 'half', ['will']),
  bloodrager: c(10, 'full', ['fort']),
  brawler: c(10, 'full', ['fort', 'ref']),
  hunter: c(8, 'threeQuarter', ['fort', 'ref']),
  investigator: c(8, 'threeQuarter', ['ref', 'will']),
  shaman: c(8, 'threeQuarter', ['will']),
  skald: c(8, 'threeQuarter', ['fort', 'will']),
  slayer: c(10, 'full', ['fort', 'ref']),
  swashbuckler: c(10, 'full', ['ref']),
  warpriest: c(8, 'threeQuarter', ['fort', 'will']),
  // Occult
  kineticist: c(8, 'threeQuarter', ['fort', 'ref']),
  medium: c(8, 'threeQuarter', ['will']),
  mesmerist: c(8, 'threeQuarter', ['ref', 'will']),
  occultist: c(8, 'threeQuarter', ['fort', 'will']),
  psychic: c(6, 'half', ['will']),
  spiritualist: c(8, 'threeQuarter', ['fort', 'will']),
  // Unchained (only the monk's chassis differs)
  monkunchained: c(10, 'full', ['fort', 'ref']),
  unchainedmonk: c(10, 'full', ['fort', 'ref']),
  barbarianunchained: c(12, 'full', ['fort']),
  unchainedbarbarian: c(12, 'full', ['fort']),
  rogueunchained: c(8, 'threeQuarter', ['ref']),
  unchainedrogue: c(8, 'threeQuarter', ['ref']),
  summonerunchained: c(8, 'threeQuarter', ['will']),
  unchainedsummoner: c(8, 'threeQuarter', ['will']),
  // NPC classes
  adept: c(6, 'half', ['will']),
  aristocrat: c(8, 'threeQuarter', ['will']),
  commoner: c(6, 'half', []),
  expert: c(8, 'threeQuarter', ['will']),
  warrior: c(10, 'full', ['fort']),
};

export function lookupClass(name: string): ClassChassis | undefined {
  return CLASSES[normalizeName(name)];
}

export function babFor(progression: BabProgression, level: number): number {
  if (progression === 'full') return level;
  if (progression === 'threeQuarter') return Math.floor((level * 3) / 4);
  return Math.floor(level / 2);
}

export function baseSaveFor(good: boolean, level: number, prestige: boolean): number {
  if (level <= 0) return 0;
  if (prestige) return good ? Math.floor((level + 1) / 2) : Math.floor((level + 1) / 3);
  return good ? 2 + Math.floor(level / 2) : Math.floor(level / 3);
}

// ------------------------------------------------------------------ sizes

export const SIZES = ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'] as const;
export type SizeName = (typeof SIZES)[number];

/** Size modifier to AC and attack rolls. */
export const SIZE_MOD: Record<SizeName, number> = {
  Fine: 8,
  Diminutive: 4,
  Tiny: 2,
  Small: 1,
  Medium: 0,
  Large: -1,
  Huge: -2,
  Gargantuan: -4,
  Colossal: -8,
};

/** Special size modifier for CMB/CMD (the inverse). */
export const SPECIAL_SIZE_MOD: Record<SizeName, number> = {
  Fine: -8,
  Diminutive: -4,
  Tiny: -2,
  Small: -1,
  Medium: 0,
  Large: 1,
  Huge: 2,
  Gargantuan: 4,
  Colossal: 8,
};

/** Token footprint in grid cells. */
export const SIZE_CELLS: Record<SizeName, number> = {
  Fine: 0.5,
  Diminutive: 0.5,
  Tiny: 0.5,
  Small: 1,
  Medium: 1,
  Large: 2,
  Huge: 3,
  Gargantuan: 4,
  Colossal: 6,
};

// ------------------------------------------------------------------ races

export interface RaceData {
  stats: Partial<Record<StatKey, number>>;
  /** +2 to one ability score of the player's choice (Human, Half-Elf, Half-Orc). */
  anyPlusTwo?: boolean;
  size: SizeName;
  speed: number;
  /** Speed isn't reduced by medium/heavy armor or encumbrance. */
  steady?: boolean;
  darkvision: number;
  lowLight: boolean;
  /** Always-on racial skill bonuses (situational ones, like stonecunning, are left out). */
  skills?: Record<string, number>;
}

const r = (
  stats: Partial<Record<StatKey, number>>,
  size: SizeName,
  speed: number,
  darkvision: number,
  lowLight: boolean,
  extra: Partial<RaceData> = {},
): RaceData => ({ stats, size, speed, darkvision, lowLight, ...extra });

const RACES: Record<string, RaceData> = {
  // Core
  human: r({}, 'Medium', 30, 0, false, { anyPlusTwo: true }),
  dwarf: r({ CON: 2, WIS: 2, CHA: -2 }, 'Medium', 20, 60, false, { steady: true }),
  elf: r({ DEX: 2, INT: 2, CON: -2 }, 'Medium', 30, 0, true, { skills: { Perception: 2 } }),
  gnome: r({ CON: 2, CHA: 2, STR: -2 }, 'Small', 20, 0, true, { skills: { Perception: 2 } }),
  halfelf: r({}, 'Medium', 30, 0, true, { anyPlusTwo: true, skills: { Perception: 2 } }),
  halforc: r({}, 'Medium', 30, 60, false, { anyPlusTwo: true, skills: { Intimidate: 2 } }),
  halfling: r({ DEX: 2, CHA: 2, STR: -2 }, 'Small', 20, 0, false, { skills: { Perception: 2, Acrobatics: 2, Climb: 2 } }),
  // Featured & uncommon
  aasimar: r({ WIS: 2, CHA: 2 }, 'Medium', 30, 60, false, { skills: { Diplomacy: 2, Perception: 2 } }),
  android: r({ DEX: 2, INT: 2, CHA: -2 }, 'Medium', 30, 60, true, { skills: { Perception: 2, 'Sense Motive': -4 } }),
  catfolk: r({ DEX: 2, CHA: 2, WIS: -2 }, 'Medium', 30, 0, true, { skills: { Perception: 2, Stealth: 2, Survival: 2 } }),
  dhampir: r({ DEX: 2, CHA: 2, CON: -2 }, 'Medium', 30, 60, true, { skills: { Bluff: 2, Perception: 2 } }),
  drow: r({ DEX: 2, CHA: 2, CON: -2 }, 'Medium', 30, 120, false, { skills: { Perception: 2 } }),
  fetchling: r({ DEX: 2, CHA: 2, WIS: -2 }, 'Medium', 30, 60, true, { skills: { 'Knowledge (Planes)': 2, Stealth: 2 } }),
  goblin: r({ DEX: 4, STR: -2, CHA: -2 }, 'Small', 30, 60, false, { skills: { Ride: 4, Stealth: 4 } }),
  hobgoblin: r({ DEX: 2, CON: 2 }, 'Medium', 30, 60, false, { skills: { Stealth: 4 } }),
  ifrit: r({ DEX: 2, CHA: 2, WIS: -2 }, 'Medium', 30, 60, false),
  kitsune: r({ DEX: 2, CHA: 2, STR: -2 }, 'Medium', 30, 0, true, { skills: { Acrobatics: 2 } }),
  kobold: r({ DEX: 2, STR: -4, CON: -2 }, 'Small', 30, 60, false, { skills: { 'Craft (Traps)': 2, Perception: 2, 'Profession (Miner)': 2 } }),
  orc: r({ STR: 4, INT: -2, WIS: -2, CHA: -2 }, 'Medium', 30, 60, false),
  oread: r({ STR: 2, WIS: 2, CHA: -2 }, 'Medium', 20, 60, false),
  ratfolk: r({ DEX: 2, INT: 2, STR: -2 }, 'Small', 20, 60, false, { skills: { 'Craft (Alchemy)': 2, Perception: 2, 'Use Magic Device': 2 } }),
  sylph: r({ DEX: 2, INT: 2, CON: -2 }, 'Medium', 30, 60, false),
  tengu: r({ DEX: 2, WIS: 2, CON: -2 }, 'Medium', 30, 0, true, { skills: { Perception: 2, Stealth: 2 } }),
  tiefling: r({ DEX: 2, INT: 2, CHA: -2 }, 'Medium', 30, 60, false, { skills: { Bluff: 2, Stealth: 2 } }),
  undine: r({ DEX: 2, WIS: 2, STR: -2 }, 'Medium', 30, 60, false),
  changeling: r({ WIS: 2, CHA: 2, CON: -2 }, 'Medium', 30, 60, false),
  duergar: r({ CON: 2, WIS: 2, CHA: -4 }, 'Medium', 20, 120, false, { steady: true }),
  gillman: r({ CON: 2, CHA: 2, WIS: -2 }, 'Medium', 30, 0, false),
  grippli: r({ DEX: 2, WIS: 2, STR: -2 }, 'Small', 30, 60, false, { skills: { Stealth: 2 } }),
  nagaji: r({ STR: 2, CHA: 2, INT: -2 }, 'Medium', 30, 0, true),
  samsaran: r({ INT: 2, WIS: 2, CON: -2 }, 'Medium', 30, 0, true),
  strix: r({ DEX: 2, CHA: -2 }, 'Medium', 30, 60, true),
  suli: r({ STR: 2, CHA: 2, INT: -2 }, 'Medium', 30, 0, true),
  svirfneblin: r({ DEX: 2, WIS: 2, STR: -2, CHA: -4 }, 'Small', 20, 120, true, { skills: { Stealth: 2, Perception: 2, 'Craft (Alchemy)': 2 } }),
  vanara: r({ DEX: 2, WIS: 2, CHA: -2 }, 'Medium', 30, 0, true),
  vishkanya: r({ DEX: 2, CHA: 2, WIS: -2 }, 'Medium', 30, 0, true, { skills: { Perception: 2, 'Escape Artist': 2, Stealth: 2 } }),
  wayang: r({ DEX: 2, INT: 2, WIS: -2 }, 'Small', 20, 60, false),
};

export function lookupRace(name: string | null): RaceData | undefined {
  if (!name) return undefined;
  const key = normalizeName(name);
  return RACES[key] ?? RACES[key.replace(/^(core|featured|uncommon)/, '')];
}

// ------------------------------------------------------------------ armor

export interface ArmorData {
  name: string;
  kind: 'armor' | 'shield';
  category: 'light' | 'medium' | 'heavy' | 'shield';
  bonus: number;
  maxDex: number | null;
  acp: number;
  /** Arcane spell failure, percent. */
  asf: number;
}

const a = (name: string, kind: ArmorData['kind'], category: ArmorData['category'], bonus: number, maxDex: number | null, acp: number, asf: number): ArmorData => ({
  name,
  kind,
  category,
  bonus,
  maxDex,
  acp,
  asf,
});

/** Longest names first so "Studded leather" wins over "Leather". */
export const ARMOR_TABLE: ArmorData[] = [
  a('Padded', 'armor', 'light', 1, 8, 0, 5),
  a('Quilted cloth', 'armor', 'light', 1, 8, 0, 10),
  a('Leather lamellar', 'armor', 'light', 4, 3, -2, 25),
  a('Studded leather', 'armor', 'light', 3, 5, -1, 15),
  a('Leather', 'armor', 'light', 2, 6, 0, 10),
  a('Wooden armor', 'armor', 'light', 3, 3, -1, 15),
  a('Chain shirt', 'armor', 'light', 4, 4, -2, 20),
  a('Haramaki', 'armor', 'light', 1, null, 0, 0),
  a('Armored coat', 'armor', 'medium', 4, 3, -2, 20),
  a('Hide', 'armor', 'medium', 4, 4, -3, 20),
  a('Scale mail', 'armor', 'medium', 5, 3, -4, 25),
  a('Chainmail', 'armor', 'medium', 6, 2, -5, 30),
  a('Chain mail', 'armor', 'medium', 6, 2, -5, 30),
  a('Breastplate', 'armor', 'medium', 6, 3, -4, 25),
  a('Mountain pattern', 'armor', 'medium', 6, 3, -4, 30),
  a('Kikko', 'armor', 'medium', 5, 4, -3, 25),
  a('Do-maru', 'armor', 'medium', 5, 4, -4, 25),
  a('Splint mail', 'armor', 'heavy', 7, 0, -7, 40),
  a('Banded mail', 'armor', 'heavy', 7, 1, -6, 35),
  a('Half-plate', 'armor', 'heavy', 8, 0, -7, 40),
  a('Full plate', 'armor', 'heavy', 9, 1, -6, 35),
  a('Stoneplate', 'armor', 'heavy', 9, 0, -6, 40),
  a('O-yoroi', 'armor', 'heavy', 8, 2, -5, 40),
  a('Tower shield', 'shield', 'shield', 4, 2, -10, 50),
  a('Heavy steel shield', 'shield', 'shield', 2, null, -2, 15),
  a('Heavy wooden shield', 'shield', 'shield', 2, null, -2, 15),
  a('Light steel shield', 'shield', 'shield', 1, null, -1, 5),
  a('Light wooden shield', 'shield', 'shield', 1, null, -1, 5),
  a('Madu', 'shield', 'shield', 1, null, -2, 10),
  a('Buckler', 'shield', 'shield', 1, null, -1, 5),
].sort((x, y) => y.name.length - x.name.length);

const NON_ARMOR_GEAR = /\b(boots?|gloves?|belt|waterskin|cloak|cape|bag|pouch|satchel|whip|saddle|harness|backpack|pack|quiver|scabbard|hat|cap|mask|coat|outfit|shirt)\b/i;

function matchesArmorName(itemName: string, armorName: string): boolean {
  const escaped = armorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+');
  if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(itemName)) return true;
  // Fall back to normalized match only for multi-word armor names (e.g. "Chainmail" vs "Chain mail").
  return armorName.includes(' ') && normalizeName(itemName).includes(normalizeName(armorName));
}

/** Match an item name like "+1 Chain Shirt (Mithral)" to armor data and its enhancement bonus. */
/** PCGen's "Shield (Small/Wood)" style names -> "Light wooden shield". */
function shieldAlias(name: string): string {
  const m = /shield\s*\(\s*(small|light|large|heavy)\s*\/\s*(wood|wooden|steel)\s*\)/i.exec(name);
  if (!m) return name;
  const weight = /small|light/i.test(m[1]!) ? 'Light' : 'Heavy';
  const material = /steel/i.test(m[2]!) ? 'steel' : 'wooden';
  return name.replace(m[0], `${weight} ${material} shield`);
}

export function lookupArmor(rawName: string): { armor: ArmorData; enhancement: number } | undefined {
  const itemName = shieldAlias(rawName);
  const armor = ARMOR_TABLE.find((x) => {
    if (!matchesArmorName(itemName, x.name)) return false;
    // Bare material names ("Leather", "Hide", "Padded") shouldn't match "Leather Boots" or "Hide Shirt".
    if (!x.name.includes(' ') && !x.name.includes('-') && NON_ARMOR_GEAR.test(itemName)) return false;
    return true;
  });
  if (!armor) return undefined;
  const enh = /\+\s*(\d)/.exec(itemName);
  return { armor, enhancement: enh ? Number(enh[1]) : 0 };
}

// ------------------------------------------------------------------ feats & traits

export type FeatTarget = 'hp' | 'initiative' | 'fort' | 'ref' | 'will' | 'ac' | 'cmd' | 'speed';

export interface FeatEffect {
  target: FeatTarget;
  /** Number, or a function of total hit dice. */
  value: number | ((hitDice: number) => number);
  type: BonusType;
  /** Only applies when not wearing medium or heavy armor (e.g. Fleet). */
  lightArmorOnly?: boolean;
  /** Can be taken multiple times (e.g. Fleet). */
  stackable?: boolean;
}

/** Feats/traits with flat, always-on effects on the core sheet numbers. */
const FEAT_EFFECTS: Record<string, FeatEffect[]> = {
  toughness: [{ target: 'hp', value: (hd) => Math.max(3, hd), type: 'untyped' }],
  improvedinitiative: [{ target: 'initiative', value: 4, type: 'untyped' }],
  greatfortitude: [{ target: 'fort', value: 2, type: 'untyped' }],
  lightningreflexes: [{ target: 'ref', value: 2, type: 'untyped' }],
  ironwill: [{ target: 'will', value: 2, type: 'untyped' }],
  dodge: [
    { target: 'ac', value: 1, type: 'dodge' },
    { target: 'cmd', value: 1, type: 'dodge' },
  ],
  fleet: [{ target: 'speed', value: 5, type: 'untyped', lightArmorOnly: true, stackable: true }],
  // Traits
  reactionary: [{ target: 'initiative', value: 2, type: 'trait' }],
  warriorofold: [{ target: 'initiative', value: 2, type: 'trait' }],
  resilient: [{ target: 'fort', value: 1, type: 'trait' }],
  indomitablefaith: [{ target: 'will', value: 1, type: 'trait' }],
};

/** Feats that change which ability or formula is used. */
export const FEAT_FLAGS = {
  agileManeuvers: 'agilemaneuvers',
  defensiveCombatTraining: 'defensivecombattraining',
} as const;

/** "Trait ~ Reactionary", "Toughness (Mythic)" -> lookup key. */
export function featKey(name: string): string {
  return normalizeName(name.replace(/^trait\s*~\s*/i, '').replace(/\(.*\)$/, ''));
}

export function lookupFeatEffects(name: string): FeatEffect[] | undefined {
  return FEAT_EFFECTS[featKey(name)];
}
