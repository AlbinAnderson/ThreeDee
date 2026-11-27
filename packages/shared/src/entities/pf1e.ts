/**
 * PF1e character entity.
 *
 * A character is split into:
 *  - `build`:   everything imported from PCGen (build choices: stats, classes,
 *               skills, feats, gear, spells...). Replaced wholesale on re-import.
 *  - `runtime`: state the VTT owns (current HP, spent daily uses...). Never
 *               touched by re-import, so levelling up in PCGen is safe.
 * Plus VTT links (owner, token) and sharing, which re-import also preserves.
 */
import { z } from 'zod';
import { PcgenCharacterSchema } from '../pcgen/schema';
import { AssetUrlSchema, ColorSchema, IdSchema } from '../primitives';

export const CharacterSourceSchema = z.object({
  kind: z.literal('pcgen'),
  fileName: z.string().max(255),
  importedAt: z.number(),
  importedBy: IdSchema,
});
export type CharacterSource = z.infer<typeof CharacterSourceSchema>;

export const StatKeySchema = z.enum(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
export const SaveKeySchema = z.enum(['fort', 'ref', 'will']);
export const SizeNameSchema = z.enum(['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal']);

/** Per-ability adjustments, e.g. { STR: 2 }. Keys are ability abbreviations. */
const StatAdjustSchema = z.partialRecord(StatKeySchema, z.number().int().min(-50).max(50));
const NonNegStatAdjustSchema = z.partialRecord(StatKeySchema, z.number().int().min(0).max(50));

// ------------------------------------------------------------------ buffs & conditions (Epic 8)

/** What a buff effect changes. Ability keys change the score; `sizeSteps` moves the size category; `extraAttack` adds a full-attack attack (haste). */
export const BuffTargetSchema = z.enum([
  'STR',
  'DEX',
  'CON',
  'INT',
  'WIS',
  'CHA',
  'attack',
  'attackMelee',
  'attackRanged',
  'damage',
  'damageMelee',
  'damageRanged',
  'ac',
  'cmb',
  'cmd',
  'initiative',
  'saves',
  'fort',
  'ref',
  'will',
  'skills',
  'speed',
  'casterLevel',
  'sizeSteps',
  'extraAttack',
]);
export type BuffTarget = z.infer<typeof BuffTargetSchema>;

export const BonusTypeSchema = z.enum([
  'untyped',
  'alchemical',
  'armor',
  'circumstance',
  'competence',
  'deflection',
  'dodge',
  'enhancement',
  'inherent',
  'insight',
  'luck',
  'morale',
  'natural',
  'profane',
  'racial',
  'resistance',
  'sacred',
  'shield',
  'size',
  'trait',
]);

export const BuffEffectSchema = z.object({
  target: BuffTargetSchema,
  value: z.number().int().min(-50).max(50),
  type: BonusTypeSchema,
});
export type BuffEffect = z.infer<typeof BuffEffectSchema>;

/**
 * A temporary effect on a character: a preset (Bless, Rage...) or a custom
 * one. Presets fill in `effects` when added (scaled for the character), so
 * every buff is just a named list of typed modifiers the player can edit.
 */
export const BuffSchema = z.object({
  id: IdSchema,
  /** Preset it came from (see pf1e/buffs.ts), or null for custom buffs. */
  presetId: z.string().max(40).nullable(),
  name: z.string().trim().min(1).max(60),
  effects: z.array(BuffEffectSchema).max(20),
  /** Reminder text for what the numbers don't cover ("+1 morale vs fear"). */
  note: z.string().max(300),
  active: z.boolean(),
  /** Rounds left; counts down at the start of the character's turn in combat. null = no duration. */
  roundsLeft: z.number().int().min(1).max(10000).nullable(),
});
export type Buff = z.infer<typeof BuffSchema>;
export const MAX_BUFFS = 40;
export const MAX_CONDITIONS = 30;
export const ConditionNameSchema = z.string().trim().min(1).max(40);

/** Highest spell level and how many metamagic feats one prepared spell or cast may carry. */
export const MAX_SPELL_LEVEL = 9;
export const MAX_METAMAGIC = 6;
const SpellNameSchema = z.string().trim().min(1).max(80);
const SpellLevelSchema = z.number().int().min(0).max(MAX_SPELL_LEVEL);
export const MetamagicListSchema = z.array(z.string().trim().min(1).max(40)).max(MAX_METAMAGIC);

/**
 * One prepared spell for the day (one casting: a spell prepared twice is two
 * entries). `level` is the slot it occupies, which metamagic raises.
 */
export const PreparedSpellSchema = z.object({
  id: IdSchema,
  name: SpellNameSchema,
  level: SpellLevelSchema,
  metamagic: MetamagicListSchema,
  /** `bonus`: the domain/school slot, which only domain/school spells may fill. */
  slot: z.enum(['normal', 'bonus']),
  /** Already cast today (prepared casters). Cantrips never get used up. */
  cast: z.boolean(),
});
export type PreparedSpell = z.infer<typeof PreparedSpellSchema>;
export const MAX_PREPARED_PER_CLASS = 120;
export const MAX_CASTING_CLASSES = 20;

export const CharacterRuntimeSchema = z.object({
  /** Current hit points tracked in the VTT; null until the sheet sets them (Epic 2). */
  hp: z
    .object({
      current: z.number().int().min(-100000).max(100000),
      temp: z.number().int().min(0).max(100000),
      nonlethal: z.number().int().min(0).max(100000),
    })
    .nullable(),
  /** Spent uses of daily/per-round resources and spell slots, keyed by resource id (Epics 6-7). */
  uses: z.record(z.string().max(120), z.number().int().min(0).max(100000)).refine((r) => Object.keys(r).length <= 200, 'Too many tracked uses'),
  /** Ability damage (lowers the modifier) and drain (lowers the score). */
  abilityDamage: NonNegStatAdjustSchema,
  abilityDrain: NonNegStatAdjustSchema,
  /** Temporary score changes from spells/items not modelled yet (e.g. Bull's Strength +4). */
  abilityTemp: StatAdjustSchema,
  /** Active combat options (Power Attack, Fight defensively...), keyed by toggle id; see pf1e/toggles.ts. */
  toggles: z.record(z.string().max(40), z.boolean()).refine((r) => Object.keys(r).length <= 30, 'Too many toggles'),
  /**
   * Spells prepared for the day, by casting class name (Epic 7). A class with no
   * entry uses the prepared book in the .pcg file until it is prepared in the VTT.
   */
  prepared: z
    .record(z.string().trim().min(1).max(80), z.array(PreparedSpellSchema).max(MAX_PREPARED_PER_CLASS))
    .refine((r) => Object.keys(r).length <= MAX_CASTING_CLASSES, 'Too many casting classes'),
  /** Temporary buffs, active or ready to switch on (Epic 8). */
  buffs: z
    .array(BuffSchema)
    .max(MAX_BUFFS)
    .refine((arr) => new Set(arr.map((b) => b.id)).size === arr.length, 'Duplicate buff id'),
  /**
   * Conditions (Shaken, Prone...) with mechanical effects. While the character
   * is linked to a token this mirrors the token's conditions; otherwise it's
   * edited on the sheet.
   */
  conditions: z.array(ConditionNameSchema).max(MAX_CONDITIONS),
});
export type CharacterRuntime = z.infer<typeof CharacterRuntimeSchema>;

export const EMPTY_RUNTIME: CharacterRuntime = { hp: null, uses: {}, abilityDamage: {}, abilityDrain: {}, abilityTemp: {}, toggles: {}, prepared: {}, buffs: [], conditions: [] };

/** Progression for a class the rules tables don't know (prestige or homebrew). */
export const ClassChassisSchema = z.object({
  hd: z.number().int().min(4).max(12),
  bab: z.enum(['full', 'threeQuarter', 'half']),
  goodSaves: z.array(SaveKeySchema).max(3),
  prestige: z.boolean(),
});

/** Sheet-only numbers that aren't modelled yet. */
export const MiscTargetSchema = z.enum(['hp', 'ac', 'natural', 'deflection', 'initiative', 'fort', 'ref', 'will', 'cmb', 'cmd']);
export type MiscTarget = z.infer<typeof MiscTargetSchema>;

/** A resource pool the rules tables don't model (Ki at higher levels, a homebrew feature...). Spent uses live in runtime.uses under `custom.<id>`. */
export const CustomPoolSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(40),
  max: z.number().int().min(0).max(999),
  unit: z.enum(['uses', 'rounds', 'points', 'minutes']),
});
export type CustomPool = z.infer<typeof CustomPoolSchema>;
export const MAX_CUSTOM_POOLS = 30;

/** Casting settings for one class, for classes the rules tables don't know or house rules. null = from the rules tables. */
export const SpellcastingOverrideSchema = z.object({
  model: z.enum(['prepared', 'spontaneous', 'hybrid']).nullable(),
  stat: StatKeySchema.nullable(),
  casterLevel: z.number().int().min(0).max(40).nullable(),
  /** Base spells per day for spell levels 0-9 (before bonus spells); null entries = can't cast that level. */
  perDay: z.array(z.number().int().min(0).max(20).nullable()).max(MAX_SPELL_LEVEL + 1).nullable(),
  /** Untyped bonus to save DCs and to concentration checks (traits, items...). */
  dcBonus: z.number().int().min(-10).max(10),
  concentrationBonus: z.number().int().min(-20).max(20),
});
export type SpellcastingOverride = z.infer<typeof SpellcastingOverrideSchema>;

/**
 * An attack typed in from a stat block (monsters imported from Archives of
 * Nethys, natural attacks): fixed bonuses instead of BAB + ability + weapon.
 */
export const StatAttackSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(60),
  mode: z.enum(['melee', 'ranged']),
  /** Attack bonuses in order ("+6/+1" -> [6, 1]). */
  bonuses: z.array(z.number().int().min(-50).max(100)).min(1).max(8),
  /** Damage dice, e.g. "1d6" (sized already). */
  dice: z.string().regex(/^[1-9]\d?d[1-9]\d{0,2}$/, 'Dice like 1d8'),
  damageBonus: z.number().int().min(-50).max(200),
  /** Lowest natural roll that threatens. */
  critRange: z.number().int().min(2).max(20),
  critMult: z.number().int().min(2).max(6),
  /** Extra effects ("plus grab", "plus 1d6 fire"). */
  note: z.string().max(120),
});
export type StatAttack = z.infer<typeof StatAttackSchema>;
export const MAX_STAT_ATTACKS = 20;

/** Sheet-side changes to one skill (kept on re-import). */
export const SkillOverrideSchema = z.object({
  /** null = ranks from the .pcg file. */
  ranks: z.number().int().min(0).max(100).nullable(),
  /** Extra untyped bonus (traits, items, anything not modelled). */
  misc: z.number().int().min(-50).max(50),
  /** null = from the .pcg file. */
  classSkill: z.boolean().nullable(),
  favorite: z.boolean(),
  /** A sub-skill added in the VTT, e.g. "Profession (Sailor)". */
  custom: z.boolean(),
});
export type SkillOverride = z.infer<typeof SkillOverrideSchema>;
export const MAX_SKILL_OVERRIDES = 200;

/**
 * Manual settings and overrides entered on the character sheet. VTT-owned,
 * so re-importing a .pcg keeps them. null = use the value from the rules data.
 */
export const CharacterSheetSchema = z.object({
  /** Ability for the racial +2 of Humans, Half-Elves, Half-Orcs. */
  racialChoice: StatKeySchema.nullable(),
  /** Class progressions by class name, for classes the rules tables don't know. */
  classChassis: z.record(z.string().max(80), ClassChassisSchema),
  /** Armor/shield AC bonus and max Dex; null = detect from the equipped gear. */
  armorBonus: z.number().int().min(0).max(40).nullable(),
  shieldBonus: z.number().int().min(0).max(40).nullable(),
  maxDex: z.number().int().min(0).max(20).nullable(),
  size: SizeNameSchema.nullable(),
  /** Feet. */
  speed: z.number().int().min(0).max(300).nullable(),
  /** Feet. */
  darkvision: z.number().int().min(0).max(600).nullable(),
  /** Extra untyped modifiers (natural armor, deflection, favored class HP...). */
  misc: z.partialRecord(MiscTargetSchema, z.number().int().min(-100).max(1000)),
  /** Per-skill overrides keyed by skill name. */
  skills: z
    .record(z.string().trim().min(1).max(80), SkillOverrideSchema)
    .refine((r) => Object.keys(r).length <= MAX_SKILL_OVERRIDES, `At most ${MAX_SKILL_OVERRIDES} skill entries`),
  /** Extra resource pools added on the sheet. */
  customPools: z
    .array(CustomPoolSchema)
    .max(MAX_CUSTOM_POOLS)
    .refine((arr) => new Set(arr.map((p) => p.id)).size === arr.length, 'Duplicate custom pool id'),
  /** Per-class spellcasting settings, by class name. */
  spellcasting: z
    .record(z.string().trim().min(1).max(80), SpellcastingOverrideSchema)
    .refine((r) => Object.keys(r).length <= MAX_CASTING_CLASSES, 'Too many casting classes'),
  /** Stat-block attacks (Epic 11 monster imports), shown and rolled with the weapon attacks. */
  statAttacks: z
    .array(StatAttackSchema)
    .max(MAX_STAT_ATTACKS)
    .refine((arr) => new Set(arr.map((a) => a.id)).size === arr.length, 'Duplicate attack id'),
});
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;

export const EMPTY_SHEET: CharacterSheet = {
  racialChoice: null,
  classChassis: {},
  armorBonus: null,
  shieldBonus: null,
  maxDex: null,
  size: null,
  speed: null,
  darkvision: null,
  misc: {},
  skills: {},
  customPools: [],
  spellcasting: {},
  statAttacks: [],
};

// ------------------------------------------------------------------ inventory

/**
 * Where an item is in a loadout. Hands, armor and shield drive attacks and AC;
 * body slots are for magic items; `carried` counts toward load; `notCarried`
 * (left at camp, dropped) doesn't.
 */
export const InventorySlotSchema = z.enum([
  'carried',
  'notCarried',
  'primary',
  'offHand',
  'bothHands',
  'armor',
  'shield',
  'head',
  'headband',
  'eyes',
  'shoulders',
  'neck',
  'chest',
  'body',
  'belt',
  'wrists',
  'hands',
  'ring',
  'feet',
]);
export type InventorySlot = z.infer<typeof InventorySlotSchema>;

export const ItemArmorSchema = z.object({
  kind: z.enum(['armor', 'shield']),
  category: z.enum(['light', 'medium', 'heavy', 'shield']),
  bonus: z.number().int().min(0).max(40),
  enhancement: z.number().int().min(0).max(10),
  /** null = no cap. */
  maxDex: z.number().int().min(0).max(20).nullable(),
  /** Armor check penalty, 0 or negative (masterwork already applied). */
  acp: z.number().int().min(-20).max(0),
  /** Arcane spell failure, percent. */
  asf: z.number().int().min(0).max(100),
});
export type ItemArmor = z.infer<typeof ItemArmorSchema>;

export const ItemWeaponSchema = z.object({
  /** Damage dice for a Medium weapon, e.g. "1d8" or "2d4". Sized for the wielder automatically. */
  damage: z.string().regex(/^[1-9]\d?d[1-9]\d{0,2}$/, 'Dice like 1d8'),
  /** Lowest natural roll that threatens (19 for 19-20). */
  critRange: z.number().int().min(2).max(20),
  critMult: z.number().int().min(2).max(6),
  /** Range increment in feet; 0 = none. A melee weapon with a range can be thrown. */
  range: z.number().int().min(0).max(1000),
  /** melee (may also be thrown if it has a range), thrown-only, or a projectile weapon. */
  type: z.enum(['melee', 'thrown', 'ranged']),
  hands: z.enum(['light', 'one', 'two']),
  /** How Strength applies to damage: full (melee, thrown, sling, composite bow), penalty only (plain bows), none (crossbows, firearms, splash weapons). */
  strDamage: z.enum(['full', 'penalty', 'none']),
  /** Usable with Weapon Finesse (light weapons, rapier, whip...). */
  finesse: z.boolean(),
  enhancement: z.number().int().min(0).max(10),
  masterwork: z.boolean(),
});
export type ItemWeapon = z.infer<typeof ItemWeaponSchema>;

/** Light an item sheds while lit, in feet. */
export const ItemLightSchema = z.object({
  bright: z.number().int().min(0).max(1000),
  dim: z.number().int().min(0).max(2000),
});

export const ItemContainerSchema = z.object({
  /** Contents don't count toward load (bag of holding, handy haversack). */
  extradimensional: z.boolean(),
  /** Pounds, for display; null = not tracked. */
  capacity: z.number().min(0).max(100000).nullable(),
});

export const InventoryItemSchema = z.object({
  /** Unique within the character's inventory. */
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(0).max(1_000_000),
  /** Pounds, each. */
  weight: z.number().min(0).max(100000),
  /** Gold pieces, each. */
  value: z.number().min(0).max(1e9),
  notes: z.string().max(4000),
  /** Container item this one is inside. */
  containerId: IdSchema.nullable(),
  charges: z.object({ current: z.number().int().min(0).max(10000), max: z.number().int().min(0).max(10000) }).nullable(),
  armor: ItemArmorSchema.nullable(),
  weapon: ItemWeaponSchema.nullable(),
  light: ItemLightSchema.nullable(),
  lit: z.boolean(),
  container: ItemContainerSchema.nullable(),
  /** Party-loot record this came from; it keeps the GM's true properties (see modules/loot). */
  lootId: IdSchema.nullable(),
  imageUrl: AssetUrlSchema.nullable(),
  /** Gems, art objects and trade goods: sold at full value instead of half (Epic 11). */
  tradeGood: z.boolean(),
  /** Rules-pack equipment KEY this item came from (exact stats, rules card), or null. */
  ruleKey: z.string().max(120).nullable(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

/** A named equipment set: where each item is. Items not listed are `carried`. */
export const LoadoutSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(60),
  slots: z.record(IdSchema, InventorySlotSchema),
});
export type Loadout = z.infer<typeof LoadoutSchema>;

export const CoinsSchema = z.object({
  pp: z.number().int().min(0).max(1e9),
  gp: z.number().int().min(0).max(1e9),
  sp: z.number().int().min(0).max(1e9),
  cp: z.number().int().min(0).max(1e9),
});
export type Coins = z.infer<typeof CoinsSchema>;

export const MAX_INVENTORY_ITEMS = 500;
export const MAX_LOADOUTS = 20;

/** VTT-owned gear: seeded from the .pcg on first import, kept on re-import unless replaced. */
export const InventorySchema = z.object({
  items: z.array(InventoryItemSchema).max(MAX_INVENTORY_ITEMS),
  coins: CoinsSchema,
  loadouts: z.array(LoadoutSchema).min(1).max(MAX_LOADOUTS),
  activeLoadoutId: IdSchema,
});
export type Inventory = z.infer<typeof InventorySchema>;

// ------------------------------------------------------------------ companions (Epic 9)

export const CompanionTypeSchema = z.enum(['familiar', 'animalCompanion', 'mount', 'eidolon', 'phantom', 'cohort', 'other']);
export type CompanionType = z.infer<typeof CompanionTypeSchema>;
export const TrickNameSchema = z.string().trim().min(1).max(40);
export const MAX_KNOWN_TRICKS = 40;
export const MAX_COMPANIONS_PER_MASTER = 20;

/**
 * Where a harbored/dismissed companion's token was and what it looked like, so
 * manifesting brings back the same token. Live HP and conditions are kept on
 * the character (like any unlinked character), not here.
 */
export const CompanionStashSchema = z.object({
  sceneId: IdSchema,
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
  name: z.string().trim().max(60),
  imageUrl: AssetUrlSchema.nullable(),
  color: ColorSchema,
  size: z.number().min(0.25).max(20),
  ownerIds: z.array(IdSchema).max(50),
  hidden: z.boolean(),
  showName: z.boolean(),
  hpVisible: z.boolean(),
  conditionRounds: z
    .record(z.string().trim().min(1).max(40), z.number().int().min(1).max(10000))
    .refine((r) => Object.keys(r).length <= 30, 'Too many condition timers'),
});
export type CompanionStash = z.infer<typeof CompanionStashSchema>;

/**
 * This character is a companion of another (its master). Lives on the
 * companion: a companion has one master, a master any number of companions.
 */
export const CompanionLinkSchema = z.object({
  masterId: IdSchema,
  type: CompanionTypeSchema,
  /** Tricks an animal knows (Handle Animal). */
  knownTricks: z
    .array(TrickNameSchema)
    .max(MAX_KNOWN_TRICKS)
    .refine((arr) => new Set(arr.map((t) => t.toLowerCase())).size === arr.length, 'Duplicate trick'),
  /** The master has the Link class feature (animal companions, special mounts): handle as a free action, push as a move action, +4 on Handle Animal. */
  link: z.boolean(),
  /** Harbored / dismissed / in its satchel: not on the map. */
  harbored: z.boolean(),
  /** The token put away when the companion was harbored (null = it had none). */
  stash: CompanionStashSchema.nullable(),
});
export type CompanionLink = z.infer<typeof CompanionLinkSchema>;

// ------------------------------------------------------------------ bio, notes & chronicle (Epic 10)

export const MAX_CHARACTER_NOTES = 200;
export const MAX_CHRONICLES = 200;
export const BIO_FIELD_MAX = 200;
export const BIO_TEXT_MAX = 10000;
export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 8000;

/** Short free-text bio fields, in display order. */
export const BIO_FIELD_KEYS = [
  'gender',
  'age',
  'height',
  'weight',
  'eyes',
  'hair',
  'skin',
  'handedness',
  'deity',
  'homeland',
  'birthplace',
  'birthday',
  'location',
  'traits',
  'speechPattern',
  'phobias',
  'interests',
  'catchPhrase',
] as const;
export type BioFieldKey = (typeof BIO_FIELD_KEYS)[number];

/** One entry of the character's notes tree. `parentId` null = a root note. */
export const CharacterNoteSchema = z.object({
  id: IdSchema,
  parentId: IdSchema.nullable(),
  title: z.string().trim().min(1).max(NOTE_TITLE_MAX),
  body: z.string().max(NOTE_BODY_MAX),
});
export type CharacterNote = z.infer<typeof CharacterNoteSchema>;

/** True if every parent exists and following parents always reaches a root (no cycles). */
export function isNoteForest(notes: readonly { id: string; parentId: string | null }[]): boolean {
  const parent = new Map(notes.map((n) => [n.id, n.parentId]));
  for (const n of notes) {
    let cur: string | null = n.parentId;
    for (let steps = 0; cur !== null; steps++) {
      if (steps > notes.length || !parent.has(cur)) return false;
      cur = parent.get(cur)!;
    }
  }
  return true;
}

export const CharacterNotesSchema = z
  .array(CharacterNoteSchema)
  .max(MAX_CHARACTER_NOTES)
  .refine((arr) => new Set(arr.map((n) => n.id)).size === arr.length, 'Duplicate note id')
  .refine(isNoteForest, 'Notes must form a tree (missing parent or cycle)');

/** A campaign / Pathfinder Society chronicle sheet entry. */
export const ChronicleEntrySchema = z.object({
  id: IdSchema,
  /** Campaign or organized-play season. */
  campaign: z.string().max(120),
  /** Adventure / scenario name. */
  scenario: z.string().max(120),
  date: z.string().max(40),
  gm: z.string().max(80),
  party: z.string().max(200),
  xp: z.number().int().min(0).max(10_000_000),
  /** Gold gained (negative = spent), gp. */
  gold: z.number().min(-1e9).max(1e9),
  fame: z.number().int().min(-100000).max(100000),
  notes: z.string().max(4000),
});
export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>;

export const ChronicleListSchema = z
  .array(ChronicleEntrySchema)
  .max(MAX_CHRONICLES)
  .refine((arr) => new Set(arr.map((n) => n.id)).size === arr.length, 'Duplicate chronicle id');

export const BioFieldsSchema = z.object(
  Object.fromEntries(BIO_FIELD_KEYS.map((k) => [k, z.string().max(BIO_FIELD_MAX)])) as Record<BioFieldKey, z.ZodString>,
);
export type BioFields = z.infer<typeof BioFieldsSchema>;

/**
 * VTT-owned biography: seeded from the .pcg on first import and kept on
 * re-import (unless the user asks to replace it), like the inventory.
 * `dmNotes` is GM-only: it is blanked for everyone else in snapshots and
 * never travels in a payload to a non-GM.
 */
export const CharacterBioSchema = z.object({
  /** Uploaded portrait (VTT asset or http(s) URL). */
  portraitUrl: AssetUrlSchema.nullable(),
  /** PORTRAIT path from the .pcg (usually a local file the browser can't read); informational only. */
  pcgPortrait: z.string().max(1000).nullable(),
  fields: BioFieldsSchema,
  /** Appearance / physical description. */
  description: z.string().max(BIO_TEXT_MAX),
  /** Background story. */
  biography: z.string().max(BIO_TEXT_MAX),
  /** GM-only notes. */
  dmNotes: z.string().max(BIO_TEXT_MAX),
  notes: CharacterNotesSchema,
  chronicles: ChronicleListSchema,
});
export type CharacterBio = z.infer<typeof CharacterBioSchema>;

export const EMPTY_BIO_FIELDS: BioFields = Object.fromEntries(BIO_FIELD_KEYS.map((k) => [k, ''])) as BioFields;
export const EMPTY_BIO: CharacterBio = {
  portraitUrl: null,
  pcgPortrait: null,
  fields: EMPTY_BIO_FIELDS,
  description: '',
  biography: '',
  dmNotes: '',
  notes: [],
  chronicles: [],
};

export const CharacterSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  /** The player who plays this character; null = GM-controlled (NPC). */
  ownerId: IdSchema.nullable(),
  /** Linked board token, if any. */
  tokenId: IdSchema.nullable(),
  /** Visible to the whole party (otherwise only the owner and GM). */
  shared: z.boolean(),
  source: CharacterSourceSchema,
  build: PcgenCharacterSchema,
  sheet: CharacterSheetSchema,
  runtime: CharacterRuntimeSchema,
  inventory: InventorySchema,
  /** Companion link to a master character (Epic 9); null = not a companion. */
  companion: CompanionLinkSchema.nullable(),
  /** Biography, portrait, notes tree, chronicle and GM notes (Epic 10). */
  bio: CharacterBioSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const MAX_CHARACTERS_PER_ROOM = 200;

/** One combatant's PF1e action economy for one turn window (see pf1e/economy.ts). */
export const Pf1TurnStateSchema = z.object({
  /** Round in which the turn this state belongs to started (0 = before their first turn). */
  window: z.number().int().min(0).max(100000),
  standard: z.boolean(),
  move: z.boolean(),
  fullRound: z.boolean(),
  swift: z.boolean(),
  fiveFoot: z.boolean(),
  /** Moved this turn (no 5-foot step allowed). */
  moved: z.boolean(),
  /** Attacks of opportunity made since this turn started. */
  aoo: z.number().int().min(0).max(50),
  /** Window whose swift action an off-turn immediate action already used. */
  immediateLock: z.number().int().min(0).max(100001).nullable(),
});
export type Pf1TurnState = z.infer<typeof Pf1TurnStateSchema>;
