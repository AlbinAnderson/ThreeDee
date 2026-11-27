/**
 * Room-level rules settings and the room's custom rules catalog (Epic 11).
 */
import { z } from 'zod';
import { ItemArmorSchema, ItemWeaponSchema } from './pf1e';
import { IdSchema } from '../primitives';

export const MAX_ALLOWED_SOURCES = 400;
export const SourceKeySchema = z.string().trim().min(1).max(120);

export const RulesSettingsSchema = z.object({
  /**
   * Books (rules pack `.pcc` keys) the campaign allows. null = no restriction
   * (every book in the pack). Catalog searches and import checks follow it.
   */
  allowedSources: z
    .array(SourceKeySchema)
    .max(MAX_ALLOWED_SOURCES)
    .refine((a) => new Set(a).size === a.length, 'Duplicate source')
    .nullable(),
});
export type RulesSettings = z.infer<typeof RulesSettingsSchema>;
export const DEFAULT_RULES_SETTINGS: RulesSettings = { allowedSources: null };

export const CustomRuleKindSchema = z.enum(['equipment', 'spell', 'feat']);
export type CustomRuleKind = z.infer<typeof CustomRuleKindSchema>;

export const MAX_CUSTOM_RULES = 500;
export const MAX_CUSTOM_RULE_FIELDS = 30;

/**
 * A rules record the GM added to this room: an Archives of Nethys import
 * (reviewed before saving) or homebrew. Searched alongside the rules pack.
 * `gmOnly` records (e.g. an item the party hasn't found yet) are only sent to GMs.
 */
export const CustomRuleSchema = z.object({
  id: IdSchema,
  kind: CustomRuleKindSchema,
  name: z.string().trim().min(1).max(120),
  /** Book and page, e.g. "Ultimate Equipment pg. 285". */
  source: z.string().max(160),
  /** Where it was imported from (an allowlisted aonprd.com page), or null. */
  aonUrl: z.string().max(500).nullable(),
  /** Description / benefit. */
  text: z.string().max(8000),
  /** Labelled plain fields ("School": "evocation [fire]", "Prerequisites": "..."). */
  fields: z
    .record(z.string().trim().min(1).max(40), z.string().max(600))
    .refine((r) => Object.keys(r).length <= MAX_CUSTOM_RULE_FIELDS, `At most ${MAX_CUSTOM_RULE_FIELDS} fields`),
  /** Equipment: price (gp) and weight (lb) each; null = unknown. */
  cost: z.number().min(0).max(1e9).nullable(),
  weight: z.number().min(0).max(100000).nullable(),
  /** Magic items: caster level (identify DC 15 + CL). */
  cl: z.number().int().min(0).max(30).nullable(),
  slot: z.string().max(40).nullable(),
  weapon: ItemWeaponSchema.nullable(),
  armor: ItemArmorSchema.nullable(),
  gmOnly: z.boolean(),
  createdAt: z.number(),
});
export type CustomRule = z.infer<typeof CustomRuleSchema>;

export const CustomRulesSchema = z
  .record(IdSchema, CustomRuleSchema)
  .refine((r) => Object.keys(r).length <= MAX_CUSTOM_RULES, `At most ${MAX_CUSTOM_RULES} custom rules`);
