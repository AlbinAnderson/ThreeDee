/**
 * Item prices with equipment mods, rules-pack records as inventory items, and
 * shopping math (Epic 11). PCGen prices most mods with formulas; the PF1e
 * pricing rules they encode are written out here (Core Rulebook ch. 6 & 15):
 *
 *  - Masterwork: weapon +300 gp, armor/shield +150 gp, ammunition +6 gp each.
 *  - Enhancement +N (implies masterwork): weapon +2,000 × N², armor/shield +1,000 × N²,
 *    ammunition +40 × N² each (magic ammunition is priced per 50).
 *  - Cold iron: weapon cost doubled; adding any enhancement costs another 2,000 gp (40 gp per piece of ammunition).
 *  - Alchemical silver: light weapon +20, one-handed +90, two-handed +180, ammunition +2 gp.
 *  - Mithral (includes masterwork): light armor +1,000, medium +4,000, heavy +9,000,
 *    shield +1,000; weapons +500 gp per pound of the base item.
 *  - Adamantine (includes masterwork): weapon +3,000, light armor +5,000,
 *    medium +10,000, heavy +15,000; ammunition +60 gp each.
 *  - Darkwood (always masterwork, priced on top of it): masterwork cost + 10 gp per pound.
 *  - Stacks ("Arrows (20)", PCGen BASEQTY) pay per-piece ammunition mods for every piece.
 *  - Potion 50 × spell level × CL, scroll 25 × SL × CL, wand 750 × SL × CL (0-level counts as ½).
 */
import type { InventoryItem, ItemArmor, ItemWeapon, RulesBonus } from '../entities/pf1e';
import { detectGear } from '../pf1e/gear';
import { makeItem } from '../pf1e/inventory';
import type { EquipmentRecord } from './types';

export const MATERIALS = ['none', 'coldIron', 'alchemicalSilver', 'mithral', 'adamantine', 'darkwood'] as const;
export type Material = (typeof MATERIALS)[number];
export const MATERIAL_LABELS: Record<Material, string> = {
  none: 'Standard',
  coldIron: 'Cold iron',
  alchemicalSilver: 'Alchemical silver',
  mithral: 'Mithral',
  adamantine: 'Adamantine',
  darkwood: 'Darkwood',
};

export interface ItemMods {
  masterwork: boolean;
  material: Material;
  /** +0..+5. */
  enhancement: number;
}

export const NO_MODS: ItemMods = { masterwork: false, material: 'none', enhancement: 0 };

export type GearKind = 'weapon' | 'ammo' | 'armor' | 'shield' | 'other';

const has = (rec: Pick<EquipmentRecord, 'types'>, t: string) => rec.types.some((x) => x.toLowerCase() === t.toLowerCase());

export function gearKind(rec: Pick<EquipmentRecord, 'types'>): GearKind {
  if (has(rec, 'Ammunition')) return 'ammo';
  if (has(rec, 'Shield')) return 'shield';
  if (has(rec, 'Armor')) return 'armor';
  if (has(rec, 'Weapon')) return 'weapon';
  return 'other';
}

/** Light / medium / heavy armor (shields count as "shield"). */
export function armorCategory(rec: Pick<EquipmentRecord, 'types'>): ItemArmor['category'] | null {
  if (has(rec, 'Shield')) return 'shield';
  if (!has(rec, 'Armor')) return null;
  if (has(rec, 'Heavy')) return 'heavy';
  if (has(rec, 'Medium')) return 'medium';
  return 'light';
}

function weaponHands(rec: Pick<EquipmentRecord, 'wield' | 'types'>): ItemWeapon['hands'] {
  const w = (rec.wield ?? '').toLowerCase();
  if (w === 'light' || has(rec, 'Light')) return 'light';
  if (w === 'twohanded' || has(rec, 'TwoHanded')) return 'two';
  return 'one';
}

/** Price of a potion, scroll or wand from the spell it holds; null for other items. */
export function spellItemPrice(rec: Pick<EquipmentRecord, 'types' | 'spellEffect'>): number | null {
  const fx = rec.spellEffect;
  if (!fx) return null;
  const sl = fx.level === 0 ? 0.5 : fx.level;
  const cl = Math.max(1, fx.cl);
  if (has(rec, 'Potion')) return 50 * sl * cl;
  if (has(rec, 'Scroll')) return 25 * sl * cl;
  if (has(rec, 'Wand')) return 750 * sl * cl;
  return null;
}

/** The record's own price (derived for potions/scrolls/wands); null = unknown. */
export function baseCost(rec: Pick<EquipmentRecord, 'cost' | 'types' | 'spellEffect'>): number | null {
  if (rec.cost !== null && rec.cost > 0) return rec.cost;
  const fromSpell = spellItemPrice(rec);
  if (fromSpell !== null) return fromSpell;
  // PCGen leaves COST:0 on magic items it prices with EQMOD formulas: the price is unknown, not free.
  if (has(rec, 'Magic')) return null;
  return rec.cost;
}

export interface PricedItem {
  name: string;
  /** gp each. */
  cost: number;
  /** lb each. */
  weight: number;
  /** What the mods add, for the price breakdown. */
  parts: { label: string; gp: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which mods make sense for an item (the UI hides the rest; pricing rejects them). */
export function allowedMods(rec: Pick<EquipmentRecord, 'types'>): { masterwork: boolean; enhancement: boolean; materials: Material[] } {
  const kind = gearKind(rec);
  if (has(rec, 'Magic') || kind === 'other') return { masterwork: false, enhancement: false, materials: ['none'] };
  if (kind === 'ammo') return { masterwork: true, enhancement: true, materials: ['none', 'coldIron', 'alchemicalSilver', 'adamantine'] };
  if (kind === 'weapon') return { masterwork: true, enhancement: true, materials: [...MATERIALS] };
  if (kind === 'shield') return { masterwork: true, enhancement: true, materials: ['none', 'mithral', 'darkwood'] };
  return { masterwork: true, enhancement: true, materials: ['none', 'mithral', 'adamantine'] };
}

/**
 * Price an item with equipment mods. Returns an error string for mods that
 * don't apply (a +3 rope, mithral arrows...).
 */
export function priceWithMods(rec: EquipmentRecord, mods: ItemMods = NO_MODS): PricedItem | string {
  const base = baseCost(rec);
  if (base === null) return `${rec.name} has no price in the rules data`;
  const enh = Math.floor(mods.enhancement);
  if (enh < 0 || enh > 5) return 'Enhancement must be +0 to +5';
  const allowed = allowedMods(rec);
  if (enh > 0 && !allowed.enhancement) return `${rec.name} can't take an enhancement bonus`;
  if (mods.masterwork && !allowed.masterwork) return `${rec.name} can't be masterwork`;
  if (!allowed.materials.includes(mods.material)) return `${rec.name} can't be made of ${MATERIAL_LABELS[mods.material].toLowerCase()}`;

  const kind = gearKind(rec);
  const weight = rec.weight ?? 0;
  const parts: PricedItem['parts'] = [{ label: rec.name, gp: base }];
  /** Ammunition mods are priced per piece; a stack record ("Arrows (20)") holds `baseQty` pieces. */
  const pieces = kind === 'ammo' ? Math.max(1, Math.floor(rec.baseQty ?? 1)) : 1;
  const each = pieces > 1 ? ` (×${pieces})` : '';
  /** Mithral and adamantine prices include masterwork; darkwood is masterwork plus 10 gp/lb. */
  const materialIncludesMasterwork = mods.material === 'mithral' || mods.material === 'adamantine';
  const masterwork = mods.masterwork || enh > 0 || materialIncludesMasterwork || mods.material === 'darkwood';
  const armorLike = kind === 'armor' || kind === 'shield';
  const category = armorCategory(rec);

  // Material (replaces the masterwork cost where it includes masterwork).
  switch (mods.material) {
    case 'coldIron':
      parts.push({ label: 'Cold iron', gp: base });
      if (enh > 0) parts.push({ label: `Cold iron enhancement surcharge${each}`, gp: kind === 'ammo' ? 40 * pieces : 2000 });
      break;
    case 'alchemicalSilver': {
      const hands = weaponHands(rec);
      parts.push({ label: `Alchemical silver${each}`, gp: kind === 'ammo' ? 2 * pieces : hands === 'light' ? 20 : hands === 'two' ? 180 : 90 });
      break;
    }
    case 'mithral':
      if (armorLike) parts.push({ label: 'Mithral', gp: category === 'heavy' ? 9000 : category === 'medium' ? 4000 : 1000 });
      else parts.push({ label: 'Mithral (500 gp/lb)', gp: 500 * weight });
      break;
    case 'adamantine':
      if (armorLike) parts.push({ label: 'Adamantine', gp: category === 'heavy' ? 15000 : category === 'medium' ? 10000 : 5000 });
      else parts.push({ label: `Adamantine${each}`, gp: kind === 'ammo' ? 60 * pieces : 3000 });
      break;
    case 'darkwood':
      parts.push({ label: 'Darkwood (10 gp/lb)', gp: 10 * weight });
      break;
    case 'none':
      break;
  }
  if (masterwork && !materialIncludesMasterwork) parts.push({ label: `Masterwork${kind === 'ammo' ? each : ''}`, gp: kind === 'ammo' ? 6 * pieces : armorLike ? 150 : 300 });
  if (enh > 0) {
    const perPlus = kind === 'ammo' ? 40 * pieces : armorLike ? 1000 : 2000;
    parts.push({ label: `+${enh} enhancement${kind === 'ammo' ? each : ''}`, gp: perPlus * enh * enh });
  }

  const lighter = mods.material === 'mithral' || mods.material === 'darkwood';
  const prefix = [enh > 0 ? `+${enh}` : null, mods.material !== 'none' ? MATERIAL_LABELS[mods.material] : masterwork && enh === 0 ? 'Masterwork' : null]
    .filter(Boolean)
    .join(' ');
  const name = prefix ? `${prefix} ${rec.name}` : rec.name;
  return {
    name: name.slice(0, 120),
    cost: round2(parts.reduce((s, p) => s + p.gp, 0)),
    weight: round2(lighter ? weight / 2 : weight),
    parts,
  };
}

const tradeGoodTypes = ['gem', 'art', 'trade', 'tradegood'];

/** Gems, art objects and trade goods sell for their full value. */
export function isTradeGood(rec: Pick<EquipmentRecord, 'types'>): boolean {
  return rec.types.some((t) => tradeGoodTypes.includes(t.toLowerCase()));
}

/** Weapon fields from a record (Medium damage), or null if it isn't a weapon. */
export function weaponFromRecord(rec: EquipmentRecord, mods: ItemMods = NO_MODS): ItemWeapon | null {
  if (!has(rec, 'Weapon') || !rec.damage || !/^[1-9]\d?d[1-9]\d{0,2}$/.test(rec.damage)) return null;
  const ranged = has(rec, 'Ranged');
  const melee = has(rec, 'Melee');
  const thrown = has(rec, 'Thrown');
  const type: ItemWeapon['type'] = melee ? 'melee' : thrown ? 'thrown' : ranged ? 'ranged' : 'melee';
  const hands = weaponHands(rec);
  const composite = has(rec, 'Composite') || /\bcomposite\b/i.test(rec.name);
  const bow = has(rec, 'Bow');
  const sling = has(rec, 'Sling');
  const strDamage: ItemWeapon['strDamage'] = type !== 'ranged' ? 'full' : composite || sling ? 'full' : bow ? 'penalty' : 'none';
  const enhancement = Math.max(0, Math.min(10, Math.floor(mods.enhancement)));
  return {
    damage: rec.damage,
    critRange: Math.max(2, Math.min(20, 21 - Math.max(1, rec.critRange ?? 1))),
    critMult: Math.max(2, Math.min(6, rec.critMult ?? 2)),
    range: Math.max(0, Math.min(1000, Math.round(rec.range ?? 0))),
    type,
    hands,
    strDamage,
    finesse: hands === 'light' || has(rec, 'Finesseable'),
    enhancement,
    masterwork: enhancement > 0 || mods.masterwork || mods.material === 'mithral' || mods.material === 'adamantine' || mods.material === 'darkwood',
  };
}

/** Armor/shield fields from a record (with masterwork / mithral / darkwood adjustments). */
export function armorFromRecord(rec: EquipmentRecord, mods: ItemMods = NO_MODS): ItemArmor | null {
  const category = armorCategory(rec);
  if (!category || rec.acBonus === null) return null;
  const enhancement = Math.max(0, Math.min(10, Math.floor(mods.enhancement)));
  const masterwork = mods.masterwork || enhancement > 0 || mods.material === 'mithral' || mods.material === 'adamantine' || mods.material === 'darkwood';
  let acp = Math.min(0, rec.acp ?? 0);
  let maxDex = rec.maxDex;
  let asf = rec.asf ?? 0;
  let cat = category;
  if (mods.material === 'mithral') {
    // Mithral: -3 check penalty (includes masterwork), +2 max Dex, -10% spell failure, one category lighter.
    acp = Math.min(0, acp + 3);
    if (maxDex !== null) maxDex += 2;
    asf = Math.max(0, asf - 10);
    if (cat === 'heavy') cat = 'medium';
    else if (cat === 'medium') cat = 'light';
  } else if (mods.material === 'darkwood' && category === 'shield') acp = Math.min(0, acp + 2);
  else if (masterwork) acp = Math.min(0, acp + 1);
  return {
    kind: category === 'shield' ? 'shield' : 'armor',
    category: cat,
    bonus: Math.max(0, Math.min(40, rec.acBonus)),
    enhancement,
    maxDex: maxDex === null ? null : Math.max(0, Math.min(20, maxDex)),
    acp: Math.max(-20, acp),
    asf: Math.max(0, Math.min(100, asf)),
  };
}

/** Filter passive static bonuses from an EquipmentRecord so armor/shield/weapon enhancement is never double-counted. */
export function itemBonusesFromRecord(rec: EquipmentRecord, armor: ItemArmor | null, weapon: ItemWeapon | null): RulesBonus[] {
  if (!rec.bonuses?.length) return [];
  return rec.bonuses
    .filter((b) => {
      if (armor && b.target === 'ac' && (b.type === 'armor' || b.type === 'shield' || b.type === 'enhancement')) return false;
      if (
        weapon &&
        b.type === 'enhancement' &&
        (b.target === 'ac' ||
          b.target === 'attack' ||
          b.target === 'attackMelee' ||
          b.target === 'attackRanged' ||
          b.target === 'damage' ||
          b.target === 'damageMelee' ||
          b.target === 'damageRanged')
      ) {
        return false;
      }
      return true;
    })
    .slice(0, 20);
}

/** A rules-pack record (with mods) as a new inventory item. */
export function itemFromRecord(rec: EquipmentRecord, id: string, mods: ItemMods = NO_MODS, quantity = 1, opts: { allowUnpriced?: boolean } = {}): InventoryItem | string {
  let priced = priceWithMods(rec, mods);
  if (typeof priced === 'string') {
    // "Add free" may add an item whose price the rules data doesn't give (value 0); buying never may.
    const plain = !mods.masterwork && mods.material === 'none' && mods.enhancement === 0;
    if (!(opts.allowUnpriced && plain && baseCost(rec) === null)) return priced;
    priced = { name: rec.name.slice(0, 120), cost: 0, weight: rec.weight ?? 0, parts: [] };
  }
  const detected = detectGear(priced.name);
  const armor = armorFromRecord(rec, mods);
  const weapon = armor ? null : weaponFromRecord(rec, mods);
  return makeItem({
    id,
    name: priced.name,
    quantity: Math.max(0, Math.min(1_000_000, Math.floor(quantity))),
    weight: Math.min(100000, priced.weight),
    value: Math.min(1e9, priced.cost),
    notes: rec.desc.slice(0, 4000),
    armor,
    weapon,
    light: detected.light,
    container: detected.container,
    charges: has(rec, 'Wand') ? { current: 50, max: 50 } : detected.charges,
    tradeGood: isTradeGood(rec),
    ruleKey: rec.key.slice(0, 120),
    bonuses: itemBonusesFromRecord(rec, armor, weapon),
  });
}

/**
 * Upgrade an imported item's rules fields with its exact pack record (matched
 * by BASEITEM / KEY). The .pcg cost and weight already include PCGen's mods, so
 * they're kept; damage, crit, range, armor bonus, max Dex, ACP and spell
 * failure come from the record, keeping the enhancement/masterwork detected
 * from the item's name and EQMODs.
 */
export function applyRecordToItem(item: InventoryItem, rec: EquipmentRecord): InventoryItem {
  const enhancement = item.weapon?.enhancement ?? item.armor?.enhancement ?? 0;
  const masterwork = item.weapon?.masterwork ?? false;
  const material: Material = /\bmithral\b/i.test(item.name) ? 'mithral' : /\bdarkwood\b/i.test(item.name) ? 'darkwood' : /\badamantine\b/i.test(item.name) ? 'adamantine' : 'none';
  const mods: ItemMods = { masterwork: masterwork || /\b(masterwork|mwk)\b/i.test(item.name) || (item.armor ? item.armor.acp > (rec.acp ?? 0) : false), material, enhancement };
  const armor = armorFromRecord(rec, mods);
  const weapon = armor ? null : weaponFromRecord(rec, mods);
  return {
    ...item,
    armor: armor ?? item.armor,
    weapon: weapon ?? (armor ? null : item.weapon),
    weight: item.weight || (rec.weight ?? 0),
    value: item.value || (baseCost(rec) ?? 0),
    tradeGood: item.tradeGood || isTradeGood(rec),
    ruleKey: rec.key.slice(0, 120),
    bonuses: itemBonusesFromRecord(rec, armor ?? item.armor, weapon ?? (armor ? null : item.weapon)),
  };
}

// ------------------------------------------------------------------ shopping

/** Total price in copper for `quantity` items at `gpEach`. */
export const priceCp = (gpEach: number, quantity: number) => Math.round(gpEach * 100) * Math.max(0, Math.floor(quantity));

/** What a merchant pays: half the item's value, full value for gems, art and trade goods. */
export function sellValueCp(item: Pick<InventoryItem, 'value' | 'tradeGood'>, quantity: number): number {
  const each = Math.round(item.value * 100);
  return Math.floor((item.tradeGood ? each : each / 2) * Math.max(0, Math.floor(quantity)));
}

/** Add copper to a purse as gold/silver/copper (platinum stays as it is). */
export function addToPurse<T extends { pp: number; gp: number; sp: number; cp: number }>(purse: T, cp: number): T {
  const add = Math.max(0, Math.floor(cp));
  return {
    ...purse,
    gp: Math.min(1e9, purse.gp + Math.floor(add / 100)),
    sp: Math.min(1e9, purse.sp + Math.floor((add % 100) / 10)),
    cp: Math.min(1e9, purse.cp + (add % 10)),
  };
}

export const formatCp = (cp: number) => {
  const gp = cp / 100;
  return `${Number.isInteger(gp) ? gp.toLocaleString('en-US') : gp.toLocaleString('en-US', { maximumFractionDigits: 2 })} gp`;
};
