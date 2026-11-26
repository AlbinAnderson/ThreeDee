/**
 * PF1e gear reference data (weapons, light sources, containers, charged
 * items) and detection of an item's rules data from its name. Detection only
 * pre-fills editable fields: whatever the table gets wrong, the player fixes
 * on the item.
 */
import type { InventoryItem, ItemArmor, ItemWeapon } from '../entities/pf1e';
import { lookupArmor, type SizeName } from './rules';

type W = Omit<ItemWeapon, 'enhancement' | 'masterwork'>;

const w = (damage: string, crit: string, range: number, hands: W['hands'], type: W['type'] = 'melee', extra: Partial<W> = {}): W => {
  const [threat, mult] = crit.split('/');
  const critRange = threat && threat.includes('-') ? Number(threat.split('-')[0]) : 20;
  const critMult = Number((mult ?? threat ?? 'x2').replace(/[x×]/, '')) || 2;
  const strDamage: W['strDamage'] = type === 'ranged' ? 'none' : 'full';
  return { damage, critRange, critMult, range, hands, type, finesse: hands === 'light', strDamage, ...extra };
};

/** Core, Advanced Player's Guide and Ultimate Combat weapons (Medium damage). Longest names match first. */
export const WEAPON_TABLE: [string, W][] = (
  [
    // Simple
    ['Unarmed strike', w('1d3', 'x2', 0, 'light')],
    ['Gauntlet', w('1d3', 'x2', 0, 'light')],
    ['Spiked gauntlet', w('1d4', 'x2', 0, 'light')],
    ['Punching dagger', w('1d4', 'x3', 0, 'light')],
    ['Dagger', w('1d4', '19-20/x2', 10, 'light')],
    ['Light mace', w('1d6', 'x2', 0, 'light')],
    ['Sickle', w('1d6', 'x2', 0, 'light')],
    ['Club', w('1d6', 'x2', 10, 'one')],
    ['Heavy mace', w('1d8', 'x2', 0, 'one')],
    ['Morningstar', w('1d8', 'x2', 0, 'one')],
    ['Shortspear', w('1d6', 'x2', 20, 'one')],
    ['Longspear', w('1d8', 'x3', 0, 'two')],
    ['Quarterstaff', w('1d6', 'x2', 0, 'two')],
    ['Boar spear', w('1d8', 'x2', 0, 'two')],
    ['Spear', w('1d8', 'x3', 20, 'two')],
    ['Heavy crossbow', w('1d10', '19-20/x2', 120, 'two', 'ranged')],
    ['Light crossbow', w('1d8', '19-20/x2', 80, 'two', 'ranged')],
    ['Dart', w('1d4', 'x2', 20, 'light', 'thrown')],
    ['Javelin', w('1d6', 'x2', 30, 'one', 'thrown')],
    ['Sling', w('1d4', 'x2', 50, 'one', 'ranged', { strDamage: 'full' })],
    ['Blowgun', w('1d2', 'x2', 20, 'two', 'ranged')],
    // Martial
    ['Throwing axe', w('1d6', 'x2', 10, 'light')],
    ['Light hammer', w('1d4', 'x2', 20, 'light')],
    ['Handaxe', w('1d6', 'x3', 0, 'light')],
    ['Kukri', w('1d4', '18-20/x2', 0, 'light')],
    ['Light pick', w('1d4', 'x4', 0, 'light')],
    ['Sap', w('1d6', 'x2', 0, 'light')],
    ['Starknife', w('1d4', 'x3', 20, 'light')],
    ['Short sword', w('1d6', '19-20/x2', 0, 'light')],
    ['Battleaxe', w('1d8', 'x3', 0, 'one')],
    ['Heavy flail', w('1d10', '19-20/x2', 0, 'two')],
    ['Flail', w('1d8', 'x2', 0, 'one')],
    ['Heavy pick', w('1d6', 'x4', 0, 'one')],
    ['Longsword', w('1d8', '19-20/x2', 0, 'one')],
    ['Rapier', w('1d6', '18-20/x2', 0, 'one', 'melee', { finesse: true })],
    ['Scimitar', w('1d6', '18-20/x2', 0, 'one')],
    ['Trident', w('1d8', 'x2', 10, 'one')],
    ['Warhammer', w('1d8', 'x3', 0, 'one')],
    ['Earth breaker', w('2d6', 'x3', 0, 'two')],
    ['Falchion', w('2d4', '18-20/x2', 0, 'two')],
    ['Glaive', w('1d10', 'x3', 0, 'two')],
    ['Greataxe', w('1d12', 'x3', 0, 'two')],
    ['Greatclub', w('1d10', 'x2', 0, 'two')],
    ['Greatsword', w('2d6', '19-20/x2', 0, 'two')],
    ['Guisarme', w('2d4', 'x3', 0, 'two')],
    ['Halberd', w('1d10', 'x3', 0, 'two')],
    ['Lance', w('1d8', 'x3', 0, 'two')],
    ['Ranseur', w('2d4', 'x3', 0, 'two')],
    ['Scythe', w('2d4', 'x4', 0, 'two')],
    ['Composite longbow', w('1d8', 'x3', 110, 'two', 'ranged', { strDamage: 'full' })],
    ['Composite shortbow', w('1d6', 'x3', 70, 'two', 'ranged', { strDamage: 'full' })],
    ['Longbow', w('1d8', 'x3', 100, 'two', 'ranged', { strDamage: 'penalty' })],
    ['Shortbow', w('1d6', 'x3', 60, 'two', 'ranged', { strDamage: 'penalty' })],
    // Exotic
    ['Kama', w('1d6', 'x2', 0, 'light')],
    ['Nunchaku', w('1d6', 'x2', 0, 'light')],
    ['Sai', w('1d4', 'x2', 10, 'light')],
    ['Siangham', w('1d6', 'x2', 0, 'light')],
    ['Wakizashi', w('1d6', '18-20/x2', 0, 'light')],
    ['Cestus', w('1d4', '19-20/x2', 0, 'light')],
    ['Brass knuckles', w('1d3', 'x2', 0, 'light')],
    ['Bastard sword', w('1d10', '19-20/x2', 0, 'one')],
    ['Dwarven waraxe', w('1d10', 'x3', 0, 'one')],
    ['Katana', w('1d8', '18-20/x2', 0, 'one')],
    ['Whip', w('1d3', 'x2', 0, 'one', 'melee', { finesse: true })],
    ['Orc double axe', w('1d8', 'x3', 0, 'two')],
    ['Spiked chain', w('2d4', 'x2', 0, 'two', 'melee', { finesse: true })],
    ['Elven curve blade', w('1d10', '18-20/x2', 0, 'two', 'melee', { finesse: true })],
    ['Dwarven urgrosh', w('1d8', 'x3', 0, 'two')],
    ['Gnome hooked hammer', w('1d6', 'x3', 0, 'two')],
    ['Two-bladed sword', w('1d8', '19-20/x2', 0, 'two')],
    ['Nodachi', w('1d10', '18-20/x2', 0, 'two')],
    ['Bolas', w('1d4', 'x2', 10, 'light', 'thrown')],
    ['Shuriken', w('1d2', 'x2', 10, 'light', 'thrown')],
    ['Hand crossbow', w('1d4', '19-20/x2', 30, 'light', 'ranged')],
    ['Repeating heavy crossbow', w('1d10', '19-20/x2', 120, 'two', 'ranged')],
    ['Repeating crossbow', w('1d8', '19-20/x2', 80, 'two', 'ranged')],
    ['Pistol', w('1d8', 'x4', 20, 'one', 'ranged')],
    ['Musket', w('1d12', 'x4', 40, 'two', 'ranged')],
    // Splash weapons: no Strength to damage.
    ["Alchemist's fire", w('1d6', 'x2', 10, 'light', 'thrown', { strDamage: 'none', finesse: false })],
    ['Acid flask', w('1d6', 'x2', 10, 'light', 'thrown', { strDamage: 'none', finesse: false })],
    ['Acid', w('1d6', 'x2', 10, 'light', 'thrown', { strDamage: 'none', finesse: false })],
    ['Holy water', w('2d4', 'x2', 10, 'light', 'thrown', { strDamage: 'none', finesse: false })],
  ] as [string, W][]
).sort((a, b) => b[0].length - a[0].length);

/** Light sources: bright / dim radius in feet. */
export const LIGHT_TABLE: [RegExp, { bright: number; dim: number }][] = [
  [/everburning torch/i, { bright: 20, dim: 40 }],
  [/\btorch\b/i, { bright: 20, dim: 40 }],
  [/bullseye lantern|lantern,?\s*\(?bullseye/i, { bright: 60, dim: 120 }],
  [/\blantern\b/i, { bright: 30, dim: 60 }],
  [/\bsunrod\b/i, { bright: 30, dim: 60 }],
  [/\blamp\b/i, { bright: 15, dim: 30 }],
  [/\bcandle\b/i, { bright: 0, dim: 5 }],
];

/** Containers: [pattern, extradimensional, capacity in lb or null]. */
const CONTAINER_TABLE: [RegExp, boolean, number | null][] = [
  [/bag of holding.*\b(iv|4)\b|bag of holding \(type iv\)/i, true, 1500],
  [/bag of holding.*\b(iii|3)\b/i, true, 1000],
  [/bag of holding.*\b(ii|2)\b/i, true, 500],
  [/bag of holding/i, true, 250],
  [/handy haversack/i, true, 120],
  [/portable hole/i, true, null],
  [/efficient quiver/i, true, null],
  [/\b(backpack|sack|bandolier|chest|haversack|satchel|quiver|scroll case|map case|potion belt|saddlebags?|belt pouch|pouch)\b/i, false, null],
];

/** Items with charges: [pattern, default max]. */
const CHARGED_TABLE: [RegExp, number][] = [
  [/^wand\b/i, 50],
  [/^staff of\b/i, 10],
];

const MATERIAL_WORDS =
  /\b(masterwork|mwk|cold iron|alchemical silver|silver(ed)?|adamantine|mithral|darkwood|dragonhide|steel|wood(en)?|iron|bronze|stone|obsidian|small|medium|large|base)\b|\(\s*\)|[+]\s*\d/gi;

/** "+1 Masterwork Longsword (Cold Iron)" -> "longsword" */
export function baseGearName(name: string): string {
  return name
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .replace(MATERIAL_WORDS, ' ')
    .replace(/[,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function lookupWeapon(name: string): W | undefined {
  const base = ` ${baseGearName(name)} `;
  const hit = WEAPON_TABLE.find(([n]) => base.includes(` ${n.toLowerCase()} `));
  return hit?.[1];
}

/** Enhancement bonus from "+2 Longsword", "Longsword +2" or a PCGen EQMOD like PLUS2W. */
export function enhancementFrom(name: string, eqmods = ''): number {
  const fromName = /\+\s*(\d)/.exec(name);
  if (fromName) return Number(fromName[1]);
  const fromMod = /PLUS(\d)/i.exec(eqmods);
  return fromMod ? Number(fromMod[1]) : 0;
}

export function masterworkFrom(name: string, eqmods = ''): boolean {
  return /masterwork|\bmwk\b/i.test(name) || /MWORK|masterwork/i.test(eqmods);
}

/** Rules data an item of this name probably has. Every field stays editable on the item. */
export function detectGear(name: string, baseItem?: string | null, eqmods = ''): Pick<InventoryItem, 'armor' | 'weapon' | 'light' | 'container' | 'charges'> {
  const names = [baseItem?.replace(/\(base\)/i, '').trim(), name].filter((n): n is string => !!n);
  const enhancement = enhancementFrom(name, eqmods);
  const masterwork = enhancement > 0 || masterworkFrom(name, eqmods);

  let armor: ItemArmor | null = null;
  for (const n of names) {
    const hit = lookupArmor(n);
    if (!hit) continue;
    const a = hit.armor;
    armor = {
      kind: a.kind,
      category: a.category,
      bonus: a.bonus,
      enhancement: Math.max(enhancement, hit.enhancement),
      maxDex: a.maxDex,
      // Masterwork armor has 1 less armor check penalty.
      acp: Math.min(0, a.acp + (masterwork && a.acp < 0 ? 1 : 0)),
      asf: a.asf,
    };
    break;
  }

  let weapon: ItemWeapon | null = null;
  if (!armor) {
    for (const n of names) {
      const hit = lookupWeapon(n);
      if (hit) {
        weapon = { ...hit, enhancement, masterwork };
        break;
      }
    }
  }

  const light = LIGHT_TABLE.find(([re]) => re.test(name))?.[1] ?? null;
  const c = CONTAINER_TABLE.find(([re]) => re.test(name));
  const container = c && !/spell component/i.test(name) ? { extradimensional: c[1], capacity: c[2] } : null;
  const max = CHARGED_TABLE.find(([re]) => re.test(name))?.[1];
  return { armor, weapon, light: light ? { ...light } : null, container, charges: max ? { current: max, max } : null };
}

// ------------------------------------------------------------------ weapon size

const STEPS = ['1d1', '1d2', '1d3', '1d4', '1d6', '1d8', '1d10', '2d6', '2d8', '3d6', '3d8', '4d6', '4d8', '6d6', '6d8', '8d6', '8d8', '12d6', '12d8', '16d6'];
const ALIASES: Record<string, string> = { '2d4': '1d8', '1d12': '2d6', '2d10': '2d8' };
const SIZE_STEP: Partial<Record<SizeName, number>> = { Fine: -4, Diminutive: -3, Tiny: -2, Small: -1, Medium: 0, Large: 1, Huge: 2, Gargantuan: 3, Colossal: 4 };

/**
 * Damage dice of a Medium weapon made for a creature of another size, following
 * the PF1e weapon size progression (2d4 and 1d12 step like 1d8 and 2d6).
 */
export function sizedDamage(medium: string, size: SizeName): string {
  const shift = SIZE_STEP[size] ?? 0;
  if (!shift) return medium;
  // Exact Core Rulebook values for the common Small/Large cases.
  const small: Record<string, string> = { '1d2': '1d1', '1d3': '1d2', '1d4': '1d3', '1d6': '1d4', '1d8': '1d6', '1d10': '1d8', '1d12': '1d10', '2d4': '1d6', '2d6': '1d10', '2d8': '2d6' };
  const large: Record<string, string> = { '1d2': '1d3', '1d3': '1d4', '1d4': '1d6', '1d6': '1d8', '1d8': '2d6', '1d10': '2d8', '1d12': '3d6', '2d4': '2d6', '2d6': '3d6', '2d8': '3d8' };
  if (shift === -1 && small[medium]) return small[medium]!;
  if (shift === 1 && large[medium]) return large[medium]!;
  const idx = STEPS.indexOf(ALIASES[medium] ?? medium);
  if (idx === -1) return medium;
  return STEPS[Math.max(0, Math.min(STEPS.length - 1, idx + shift))]!;
}

// ------------------------------------------------------------------ carrying capacity

/** Heavy load (lb) for a Medium biped, Str 1-29 (Core Rulebook Table 7-4). */
const HEAVY_LOAD = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 115, 130, 150, 175, 200, 230, 260, 300, 350, 400, 460, 520, 600, 700, 800, 920, 1040, 1200, 1400];

/** Biped size multipliers for carrying capacity. */
export const CARRY_SIZE_MULT: Record<SizeName, number> = {
  Fine: 1 / 8,
  Diminutive: 1 / 4,
  Tiny: 1 / 2,
  Small: 3 / 4,
  Medium: 1,
  Large: 2,
  Huge: 4,
  Gargantuan: 8,
  Colossal: 16,
};

export interface CarryingCapacity {
  light: number;
  medium: number;
  heavy: number;
}

/** Light / medium / heavy load limits in pounds. Str above 29: ×4 per 10 points. */
export function carryingCapacity(str: number, size: SizeName): CarryingCapacity {
  const s = Math.max(0, Math.floor(str));
  let heavy: number;
  if (s <= 29) heavy = HEAVY_LOAD[s]!;
  else {
    const tens = Math.floor((s - 20) / 10);
    heavy = HEAVY_LOAD[s - tens * 10]! * 4 ** tens;
  }
  heavy *= CARRY_SIZE_MULT[size];
  // Light and medium are a third and two thirds of heavy, rounded down as in the table.
  return { light: Math.floor(heavy / 3), medium: Math.floor((heavy * 2) / 3), heavy };
}

// ------------------------------------------------------------------ coins

/** 50 coins weigh a pound. */
export const COINS_PER_POUND = 50;

export const coinsValue = (c: { pp: number; gp: number; sp: number; cp: number }) => c.pp * 10 + c.gp + c.sp / 10 + c.cp / 100;

/** A gp amount as coins (gold, silver, copper; no platinum). */
export function coinsFromGp(gp: number): { pp: number; gp: number; sp: number; cp: number } {
  const cp = Math.max(0, Math.round(gp * 100));
  return { pp: 0, gp: Math.floor(cp / 100), sp: Math.floor((cp % 100) / 10), cp: cp % 10 };
}

/**
 * Pay `costCp` copper's worth from a purse, breaking larger coins as needed
 * (smallest coins go first). Returns null if the purse can't cover it.
 */
export function payFromPurse(purse: { pp: number; gp: number; sp: number; cp: number }, costCp: number): { pp: number; gp: number; sp: number; cp: number } | null {
  const total = purse.pp * 1000 + purse.gp * 100 + purse.sp * 10 + purse.cp;
  if (costCp < 0 || costCp > total) return null;
  const out = { ...purse };
  let owed = costCp;
  const denoms: [keyof typeof out, number][] = [
    ['cp', 1],
    ['sp', 10],
    ['gp', 100],
    ['pp', 1000],
  ];
  // Spend small coins first, as far as they go.
  for (const [k, v] of denoms) {
    const use = Math.min(out[k], Math.floor(owed / v));
    out[k] -= use;
    owed -= use * v;
  }
  // Break the smallest coin that covers the rest, and take the change in smaller coins.
  for (const [k, v] of denoms) {
    if (owed === 0) break;
    if (out[k] > 0 && v >= owed) {
      out[k] -= 1;
      let change = v - owed;
      owed = 0;
      for (const [k2, v2] of [...denoms].reverse()) {
        if (v2 >= v) continue;
        const n = Math.floor(change / v2);
        out[k2] += n;
        change -= n * v2;
      }
    }
  }
  return owed === 0 ? out : null;
}
