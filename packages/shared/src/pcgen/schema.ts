/**
 * Zod schemas and TypeScript types for parsed PCGen (.pcg) character files.
 *
 * Designed to be structured and lossless: known PCG sections are mapped into
 * strongly-typed fields, while any unrecognized sub-tags or lines are retained
 * in `extra` / `unknownLines` so nothing from the source file is dropped.
 */
import { z } from 'zod';

export const PCGEN_JSON_FORMAT = 'pcgen-pcg' as const;
export const PCGEN_JSON_VERSION = 1 as const;

// ---------------------------------------------------------------- low-level tokens

export interface PcgenToken {
  tag: string;
  value: string;
  subTokens?: PcgenToken[];
}

export const PcgenTokenSchema: z.ZodType<PcgenToken> = z.lazy(() =>
  z.object({
    tag: z.string(),
    value: z.string(),
    subTokens: z.array(PcgenTokenSchema).optional(),
  }),
);

export const PcgenRawLineSchema = z.object({
  lineNumber: z.number().int().positive(),
  tag: z.string(),
  raw: z.string(),
  tokens: z.array(PcgenTokenSchema),
});
export type PcgenRawLine = z.infer<typeof PcgenRawLineSchema>;

// ---------------------------------------------------------------- system

export const PcgenRollMethodSchema = z.object({
  method: z.number().int().nullable(),
  rawMethod: z.string().nullable(),
  expression: z.string().nullable(),
});
export type PcgenRollMethod = z.infer<typeof PcgenRollMethodSchema>;

export const PcgenPurchasePointsSchema = z.object({
  enabled: z.boolean(),
  type: z.string().nullable(),
});
export type PcgenPurchasePoints = z.infer<typeof PcgenPurchasePointsSchema>;

export const PcgenSystemSchema = z.object({
  pcgVersion: z.string().nullable(),
  pcgenVersion: z.string().nullable(),
  gameMode: z.string().nullable(),
  characterType: z.string().nullable(),
  campaigns: z.array(z.string()),
  rollMethod: PcgenRollMethodSchema.nullable(),
  purchasePoints: PcgenPurchasePointsSchema.nullable(),
  previewSheet: z.string().nullable(),
  tabLabel: z.string().nullable(),
  poolPoints: z.number().nullable(),
  poolPointsAvail: z.number().nullable(),
  settings: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
});
export type PcgenSystem = z.infer<typeof PcgenSystemSchema>;

// ---------------------------------------------------------------- bio

export const PcgenBioSchema = z.object({
  name: z.string().nullable(),
  tabName: z.string().nullable(),
  playerName: z.string().nullable(),
  gender: z.string().nullable(),
  handed: z.string().nullable(),
  age: z.number().nullable(),
  ageSet: z.string().nullable(),
  height: z.number().nullable(),
  weight: z.number().nullable(),
  skinColor: z.string().nullable(),
  eyeColor: z.string().nullable(),
  hairColor: z.string().nullable(),
  hairStyle: z.string().nullable(),
  location: z.string().nullable(),
  city: z.string().nullable(),
  birthday: z.string().nullable(),
  birthplace: z.string().nullable(),
  personalityTrait1: z.string().nullable(),
  personalityTrait2: z.string().nullable(),
  speechPattern: z.string().nullable(),
  phobias: z.string().nullable(),
  interests: z.string().nullable(),
  catchPhrase: z.string().nullable(),
  portrait: z.string().nullable(),
  portraitThumbnailRect: z.string().nullable(),
  description: z.string().nullable(),
  biography: z.string().nullable(),
  companions: z.string().nullable(),
  assets: z.string().nullable(),
  magic: z.string().nullable(),
  dmNotes: z.string().nullable(),
  suppressBioFields: z.array(z.string()),
});
export type PcgenBio = z.infer<typeof PcgenBioSchema>;

// ---------------------------------------------------------------- attributes

export const PcgenDeitySchema = z.object({
  name: z.string(),
  alignment: z.string().nullable(),
  allowedAlignments: z.string().nullable(),
  domains: z.array(z.string()),
  favoredWeapons: z.array(z.string()),
  holyItem: z.string().nullable(),
  description: z.string().nullable(),
  symbol: z.string().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenDeity = z.infer<typeof PcgenDeitySchema>;

export const PcgenDomainSchema = z.object({
  name: z.string(),
  grants: z.string().nullable(),
  source: z.record(z.string(), z.string()).nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenDomain = z.infer<typeof PcgenDomainSchema>;

export const PcgenAppliedTemplateSchema = z.object({
  name: z.string(),
  chosenTemplates: z.array(z.string()),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenAppliedTemplate = z.infer<typeof PcgenAppliedTemplateSchema>;

export const PcgenAttributesSchema = z.object({
  stats: z.record(z.string(), z.number()),
  alignment: z.string().nullable(),
  race: z.string().nullable(),
  favoredClasses: z.array(z.string()),
  region: z.string().nullable(),
  templates: z.array(z.string()),
  appliedTemplates: z.array(PcgenAppliedTemplateSchema),
  deity: PcgenDeitySchema.nullable(),
  domains: z.array(PcgenDomainSchema),
  languages: z.array(z.string()),
  weaponProficiencies: z.array(z.string()),
});
export type PcgenAttributes = z.infer<typeof PcgenAttributesSchema>;

// ---------------------------------------------------------------- classes & levels

export const PcgenClassSchema = z.object({
  name: z.string(),
  level: z.number().int(),
  subClass: z.string().nullable(),
  skillPool: z.number().nullable(),
  spellBase: z.string().nullable(),
  canCastPerDay: z.string().nullable(),
  specialty: z.string().nullable(),
  prohibited: z.array(z.string()),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenClass = z.infer<typeof PcgenClassSchema>;

export const PcgenClassLevelSchema = z.object({
  className: z.string(),
  level: z.number().int(),
  hitPoints: z.number().nullable(),
  skillsGained: z.number().nullable(),
  skillsRemaining: z.number().nullable(),
  specialties: z.array(z.string()),
  statIncreases: z.record(z.string(), z.number()),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenClassLevel = z.infer<typeof PcgenClassLevelSchema>;

// ---------------------------------------------------------------- skills

export const PcgenSkillClassBoughtSchema = z.object({
  className: z.string(),
  ranks: z.number(),
  cost: z.number().nullable(),
  classSkill: z.boolean().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenSkillClassBought = z.infer<typeof PcgenSkillClassBoughtSchema>;

export const PcgenSkillSchema = z.object({
  name: z.string(),
  outputOrder: z.number().int().nullable(),
  totalRanks: z.number(),
  classBought: z.array(PcgenSkillClassBoughtSchema),
  synergy: z.string().nullable(),
  associatedData: z.array(z.string()),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenSkill = z.infer<typeof PcgenSkillSchema>;

// ---------------------------------------------------------------- abilities & feats

export const PcgenAbilitySchema = z.object({
  /** Sub-category / pool name from the leading `ABILITY:<pool>` token (e.g. "Alchemist Discovery", "Traits", "FEAT"). */
  pool: z.string(),
  /** Parent category from `CATEGORY:<category>` (e.g. "Special Ability", "Archetype", "FEAT"). */
  category: z.string(),
  key: z.string(),
  nature: z.string().nullable(),
  types: z.array(z.string()),
  appliedTo: z.array(z.string()),
  description: z.string().nullable(),
  cost: z.number().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenAbility = z.infer<typeof PcgenAbilitySchema>;

// ---------------------------------------------------------------- equipment

export const PcgenEquipmentCustomizationSchema = z.object({
  baseItem: z.string().nullable(),
  rawData: z.string().nullable(),
  data: z.record(z.string(), z.array(z.string())),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenEquipmentCustomization = z.infer<typeof PcgenEquipmentCustomizationSchema>;

export const PcgenEquipmentItemSchema = z.object({
  name: z.string(),
  outputOrder: z.number().int().nullable(),
  cost: z.number().nullable(),
  weight: z.number().nullable(),
  quantity: z.number().nullable(),
  note: z.string().nullable(),
  customization: PcgenEquipmentCustomizationSchema.nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenEquipmentItem = z.infer<typeof PcgenEquipmentItemSchema>;

export const PcgenEquipmentSetItemSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  location: z.string(),
  itemName: z.string().nullable(),
  quantity: z.number().nullable(),
  useTempMods: z.boolean().nullable(),
  note: z.string().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenEquipmentSetItem = z.infer<typeof PcgenEquipmentSetItemSchema>;

export const PcgenEquipmentSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  useTempMods: z.boolean().nullable(),
  items: z.array(PcgenEquipmentSetItemSchema),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenEquipmentSet = z.infer<typeof PcgenEquipmentSetSchema>;

// ---------------------------------------------------------------- spells

export const PcgenSpellBookSchema = z.object({
  name: z.string(),
  type: z.number().int().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenSpellBook = z.infer<typeof PcgenSpellBookSchema>;

export const PcgenSpellListSchema = z.object({
  className: z.string().nullable(),
  level: z.number().int().nullable(),
  spells: z.array(z.string()),
  raw: z.string(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenSpellList = z.infer<typeof PcgenSpellListSchema>;

export const PcgenSpellEntrySchema = z.object({
  spellName: z.string(),
  className: z.string().nullable(),
  book: z.string().nullable(),
  level: z.number().int().nullable(),
  times: z.number().int().nullable(),
  casterLevel: z.number().int().nullable(),
  dc: z.number().int().nullable(),
  metamagic: z.array(z.string()),
  source: z.record(z.string(), z.string()).nullable(),
  ppCost: z.number().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenSpellEntry = z.infer<typeof PcgenSpellEntrySchema>;

export const PcgenSpellsSchema = z.object({
  spellBooks: z.array(PcgenSpellBookSchema),
  spellLists: z.array(PcgenSpellListSchema),
  entries: z.array(PcgenSpellEntrySchema),
});
export type PcgenSpells = z.infer<typeof PcgenSpellsSchema>;

// ---------------------------------------------------------------- misc sections

export const PcgenTempBonusSchema = z.object({
  name: z.string(),
  target: z.string().nullable(),
  description: z.string().nullable(),
  equipSetId: z.string().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenTempBonus = z.infer<typeof PcgenTempBonusSchema>;

export const PcgenNoteSchema = z.object({
  id: z.number().int().nullable(),
  parentId: z.number().int().nullable(),
  name: z.string(),
  value: z.string(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenNote = z.infer<typeof PcgenNoteSchema>;

export const PcgenCompanionRefSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  race: z.string().nullable(),
  hitDice: z.number().nullable(),
  adjustment: z.number().nullable(),
  file: z.string().nullable(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenCompanionRef = z.infer<typeof PcgenCompanionRefSchema>;

export const PcgenKitSchema = z.object({
  count: z.number().int().nullable(),
  name: z.string(),
  extra: z.array(PcgenTokenSchema),
});
export type PcgenKit = z.infer<typeof PcgenKitSchema>;

// ---------------------------------------------------------------- root character

export const PcgenCharacterSchema = z.object({
  format: z.literal(PCGEN_JSON_FORMAT),
  schemaVersion: z.literal(PCGEN_JSON_VERSION),
  system: PcgenSystemSchema,
  bio: PcgenBioSchema,
  attributes: PcgenAttributesSchema,
  experience: z.object({
    xp: z.number().nullable(),
    table: z.string().nullable(),
  }),
  money: z.object({
    amount: z.number().nullable(),
    raw: z.string().nullable(),
  }),
  classes: z.array(PcgenClassSchema),
  classLevels: z.array(PcgenClassLevelSchema),
  skills: z.array(PcgenSkillSchema),
  abilities: z.array(PcgenAbilitySchema),
  /** Legacy PCG FEAT lines (pre-6.x or explicit FEAT: tags). */
  legacyFeats: z.array(z.string()),
  /** Legacy PCG VFEAT lines. */
  virtualFeats: z.array(z.string()),
  /** Ability / feat point pools keyed by pool category (e.g. FEAT). */
  abilityPools: z.record(z.string(), z.number()),
  equipment: z.array(PcgenEquipmentItemSchema),
  equipmentSets: z.array(PcgenEquipmentSetSchema),
  activeEquipmentSetId: z.string().nullable(),
  spells: PcgenSpellsSchema,
  tempBonuses: z.array(PcgenTempBonusSchema),
  notes: z.array(PcgenNoteSchema),
  companions: z.object({
    masters: z.array(PcgenCompanionRefSchema),
    followers: z.array(PcgenCompanionRefSchema),
  }),
  kits: z.array(PcgenKitSchema),
  chronicleEntries: z.array(PcgenRawLineSchema),
  warnings: z.array(z.string()),
  unknownLines: z.array(PcgenRawLineSchema),
});

export type PcgenCharacter = z.infer<typeof PcgenCharacterSchema>;
