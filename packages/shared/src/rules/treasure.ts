/**
 * GM treasure generator (Epic 11): what goes into the party loot when the GM
 * rolls or picks an item from the catalog. Items drop unidentified: the
 * public side shows a generic name ("Unidentified ring"); the true name,
 * value, caster level and description stay GM-only until identified.
 */
import type { LootItem } from '../state';
import { baseCost } from './pricing';
import type { EquipmentRecord } from './types';

export const TREASURE_BANDS = [
  { id: 'any', label: 'Any price', min: 0, max: Infinity },
  { id: 'trinket', label: 'Up to 250 gp', min: 0, max: 250 },
  { id: 'lesser', label: '250 – 1,000 gp', min: 250, max: 1000 },
  { id: 'minor', label: '1,000 – 5,000 gp', min: 1000, max: 5000 },
  { id: 'medium', label: '5,000 – 20,000 gp', min: 5000, max: 20000 },
  { id: 'major', label: '20,000 – 100,000 gp', min: 20000, max: 100000 },
  { id: 'epic', label: 'Over 100,000 gp', min: 100000, max: Infinity },
] as const;
export type TreasureBand = (typeof TREASURE_BANDS)[number]['id'];

export const TREASURE_TYPES = ['any', 'potion', 'scroll', 'wand', 'ring', 'rod', 'staff', 'wondrous', 'weapon', 'armor', 'mundane'] as const;
export type TreasureType = (typeof TREASURE_TYPES)[number];

const lower = (types: readonly string[]) => new Set(types.map((t) => t.toLowerCase()));

/** Whether an equipment record is of a treasure type. */
export function matchesTreasureType(rec: Pick<EquipmentRecord, 'types'>, type: TreasureType): boolean {
  const t = lower(rec.types);
  const magic = t.has('magic');
  switch (type) {
    case 'any':
      return true;
    case 'mundane':
      return !magic;
    case 'weapon':
      return magic && t.has('weapon');
    case 'armor':
      return magic && (t.has('armor') || t.has('shield'));
    case 'wondrous':
      return magic && t.has('wondrous');
    default:
      return t.has(type);
  }
}

/** Generic name players see before identifying, from the item's type and slot. */
export function unidentifiedName(rec: Pick<EquipmentRecord, 'types' | 'slot' | 'baseItem' | 'name'>): string {
  const t = lower(rec.types);
  const base = rec.baseItem?.replace(/\s*\(base\)\s*$/i, '').trim();
  const kinds: [string, string][] = [
    ['potion', 'potion'],
    ['scroll', 'scroll'],
    ['wand', 'wand'],
    ['ring', 'ring'],
    ['rod', 'rod'],
    ['staff', 'staff'],
  ];
  for (const [type, label] of kinds) if (t.has(type)) return `Unidentified ${label}`;
  if ((t.has('weapon') || t.has('armor') || t.has('shield')) && base) return `Unidentified ${base.toLowerCase()}`;
  const slot = (rec.slot ?? '').toLowerCase();
  const bySlot: Record<string, string> = {
    shoulders: 'cloak',
    head: 'headgear',
    headband: 'headband',
    eyes: 'eyewear',
    neck: 'amulet',
    chest: 'vest',
    body: 'robe',
    belt: 'belt',
    wrists: 'bracers',
    hands: 'gloves',
    feet: 'boots',
  };
  if (bySlot[slot]) return `Unidentified ${bySlot[slot]}`;
  return t.has('magic') ? 'Unidentified magic item' : rec.name;
}

const gp = (n: number) => `${Math.round(n * 100) / 100 >= 1000 ? Math.round(n).toLocaleString('en-US') : Math.round(n * 100) / 100} gp`;

export type TreasureLoot = {
  item: Pick<LootItem, 'name' | 'imageUrl' | 'quantity' | 'value' | 'holderId' | 'notes'>;
  secret: Pick<LootItem, 'trueName' | 'secretValue' | 'secretNotes' | 'cl'>;
};

/** Loot record fields for a treasure item (unidentified unless it's mundane). */
export function treasureFromRecord(rec: EquipmentRecord, quantity = 1): TreasureLoot {
  const cost = baseCost(rec);
  const magic = rec.types.some((t) => t.toLowerCase() === 'magic');
  const cl = rec.cl ?? rec.spellEffect?.cl ?? null;
  const citation = `${rec.source.long}${rec.source.page ? ` ${rec.source.page}` : ''}`;
  const details = [rec.aura ? `Aura ${rec.aura}` : null, cl !== null ? `CL ${cl}` : null, rec.slot && rec.slot !== 'none' ? `Slot ${rec.slot}` : null, citation]
    .filter(Boolean)
    .join('; ');
  const secretNotes = `${details}\n\n${rec.desc}`.trim().slice(0, 10000);
  if (!magic) {
    // Mundane goods: nothing to identify, everything public.
    return {
      item: { name: rec.name.slice(0, 120), imageUrl: null, quantity, value: cost !== null ? gp(cost).slice(0, 60) : '', holderId: null, notes: secretNotes },
      secret: { trueName: '', secretValue: '', secretNotes: '', cl: null },
    };
  }
  return {
    item: { name: unidentifiedName(rec).slice(0, 120), imageUrl: null, quantity, value: '', holderId: null, notes: '' },
    secret: {
      trueName: rec.name.slice(0, 120),
      secretValue: cost !== null ? gp(cost).slice(0, 60) : '',
      secretNotes,
      cl: cl === null ? null : Math.max(0, Math.min(30, Math.floor(cl))),
    },
  };
}
