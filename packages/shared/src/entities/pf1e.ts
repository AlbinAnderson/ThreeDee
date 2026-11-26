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
import { IdSchema } from '../primitives';

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
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const MAX_CHARACTERS_PER_ROOM = 200;
