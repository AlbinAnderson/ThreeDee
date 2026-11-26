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
});
export type CharacterRuntime = z.infer<typeof CharacterRuntimeSchema>;

export const EMPTY_RUNTIME: CharacterRuntime = { hp: null, uses: {} };

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
  runtime: CharacterRuntimeSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const MAX_CHARACTERS_PER_ROOM = 200;
