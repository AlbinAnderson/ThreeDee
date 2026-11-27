/**
 * Rules pack records (Epic 11). A rules pack is built on the server from the
 * PCGen data folder (`npm run vtt -- rules build <dir>`) and never committed:
 * Paizo data is OGL / Community Use, so the built pack stays on the server.
 *
 * Every record is keyed by its PCGen KEY and carries the book it came from.
 * Only plain fields are kept (no formula interpreter): what PCGen computes
 * with formulas (most magic item prices, scaled damage) is either derived
 * here from documented PF1e rules (see pricing.ts) or left for the user.
 */

export const RULES_KINDS = ['equipment', 'equipmod', 'spell', 'feat', 'ability', 'deity', 'domain'] as const;
export type RulesKind = (typeof RULES_KINDS)[number];

/** Where a record comes from: the book (`.pcc` campaign) and page. */
export interface RulesSource {
  /** `.pcc` KEY / CAMPAIGN name, e.g. "Core Rulebook". Used for per-room allowed sources. */
  campaign: string;
  /** SOURCELONG, e.g. "Core Rulebook". */
  long: string;
  /** SOURCESHORT, e.g. "CR". */
  short: string;
  /** SOURCEPAGE, e.g. "p.283". */
  page: string | null;
}

interface RecordBase {
  kind: RulesKind;
  /** PCGen KEY (defaults to the name). Unique per kind. */
  key: string;
  name: string;
  source: RulesSource;
  /** Description / benefit text with PCGen formula placeholders stripped. */
  desc: string;
  /** PCGen TYPE values ("Weapon", "Martial", "Magic", "Wondrous"...). */
  types: string[];
  /** VISIBLE:NO records (base items, internal abilities): only for lookups, never listed in searches. */
  hidden?: boolean;
}

export interface EquipmentRecord extends RecordBase {
  kind: 'equipment';
  /** gp; null = not given (PCGen computes it, e.g. potions from their spell). */
  cost: number | null;
  /** lb. */
  weight: number | null;
  /** KEY of the base item this one was made from (`Longsword (Base)`). */
  baseItem: string | null;
  /** Weapon fields (Medium). */
  damage: string | null;
  critRange: number | null;
  critMult: number | null;
  range: number | null;
  wield: string | null;
  /** Armor/shield fields. */
  acBonus: number | null;
  maxDex: number | null;
  acp: number | null;
  asf: number | null;
  /** QUALITY:Slot (shoulders, ring, none...). */
  slot: string | null;
  /** QUALITY:Caster Level. */
  cl: number | null;
  aura: string | null;
  /** EQMOD keys applied by the record (materials, +N, special abilities). */
  eqmods: string[];
  /** Potions, scrolls and wands: the spell they hold (their price follows from it). */
  spellEffect: { name: string; level: number; cl: number } | null;
}

export interface EquipmodRecord extends RecordBase {
  kind: 'equipmod';
  /** COST as written (a number, or a formula such as "WT*10"). */
  cost: string | null;
  /** ITYPE values ("Masterwork", "Metal"...). */
  itypes: string[];
}

export interface SpellRecord extends RecordBase {
  kind: 'spell';
  school: string | null;
  subschool: string | null;
  descriptors: string[];
  /** Class name -> spell level. */
  classes: Record<string, number>;
  /** Domain / mystery / bloodline name -> spell level. */
  domains: Record<string, number>;
  castTime: string | null;
  components: string | null;
  range: string | null;
  /** TARGETAREA: area, target or effect line ("20-ft.-radius spread", "one creature"). */
  targetArea: string | null;
  duration: string | null;
  save: string | null;
  sr: string | null;
}

export interface FeatRecord extends RecordBase {
  kind: 'feat' | 'ability';
  /** Ability CATEGORY ("FEAT", "Special Ability", "Trait"...). */
  category: string;
  benefit: string;
  /** Human-readable prerequisites summarised from the PRExxx tokens. */
  prereqs: string;
}

export interface DeityRecord extends RecordBase {
  kind: 'deity';
  alignment: string | null;
  domains: string[];
  favoredWeapon: string | null;
  symbol: string | null;
}

export interface DomainRecord extends RecordBase {
  kind: 'domain';
}

export type RulesRecord = EquipmentRecord | EquipmodRecord | SpellRecord | FeatRecord | DeityRecord | DomainRecord;
export type RecordOf<K extends RulesKind> = Extract<RulesRecord, { kind: K }> | (K extends 'feat' | 'ability' ? FeatRecord : never);

/** A book (.pcc) in the pack, for the GM's allowed-sources picker. */
export interface RulesBook {
  /** `.pcc` KEY (or CAMPAIGN). */
  key: string;
  name: string;
  short: string;
  publisher: string;
  bookType: string;
  /** Records the pack has from this book. */
  records: number;
}

export interface RulesManifest {
  format: 'vtt-rules-pack';
  version: 1;
  builtAt: number;
  /** Folder name the pack was built from (no absolute path). */
  from: string;
  counts: Record<RulesKind, number>;
  books: RulesBook[];
  warnings: string[];
}

export interface RulesStatus {
  loaded: boolean;
  builtAt: number | null;
  counts: Partial<Record<RulesKind, number>>;
  books: number;
}

/** A compact search hit (what lists show). */
export interface RulesHit {
  kind: RulesKind;
  key: string;
  name: string;
  source: RulesSource;
  /** Short line: price/slot for items, school/level for spells, type for feats. */
  summary: string;
  /** Item price in gp (equipment only, derived when not given). */
  cost?: number | null;
  /** Custom room record id (AoN imports and homebrew); absent = from the pack. */
  customId?: string;
}

/**
 * Synchronous lookups into the loaded rules pack. The server passes one to
 * action `prepare()` so prices and spell cards come from the pack and can't be
 * faked by clients; when no pack is built every lookup returns undefined and
 * callers fall back to the built-in tables.
 */
export interface RulesProvider {
  get<K extends RulesKind>(kind: K, key: string): RecordOf<K> | undefined;
  /** Look up by display name (case/punctuation-insensitive, PCGen variant forms). */
  byName<K extends RulesKind>(kind: K, name: string): RecordOf<K> | undefined;
}

export const NO_RULES: RulesProvider = { get: () => undefined, byName: () => undefined };
