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
import { AssetUrlSchema, IdSchema } from '../primitives';

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
  uses: z.record(z.string().max(120), z.number().int().min(0).max(100000)),
  /** Ability damage (lowers the modifier) and drain (lowers the score). */
  abilityDamage: NonNegStatAdjustSchema,
  abilityDrain: NonNegStatAdjustSchema,
  /** Temporary score changes from spells/items not modelled yet (e.g. Bull's Strength +4). */
  abilityTemp: StatAdjustSchema,
});
export type CharacterRuntime = z.infer<typeof CharacterRuntimeSchema>;

export const EMPTY_RUNTIME: CharacterRuntime = { hp: null, uses: {}, abilityDamage: {}, abilityDrain: {}, abilityTemp: {} };

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
