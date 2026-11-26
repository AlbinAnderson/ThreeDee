/**
 * Table-play entities: turn tracker, area templates, handouts, saved rolls,
 * audio, rollable tables and card decks.
 */
import { z } from 'zod';
import { AssetUrlSchema, ColorSchema, CoordSchema, IdSchema } from '../primitives';

// ---------------------------------------------------------------- turn tracker

export const CombatantSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(60),
  /** Linked token (owners of the token control the combatant). */
  tokenId: IdSchema.nullable(),
  initiative: z.number().min(-1000).max(1000).nullable(),
  /** Initiative modifier: rolled with, and used to break ties. */
  modifier: z.number().int().min(-100).max(100),
  /** Shown only to the GM (like hidden tokens). */
  hidden: z.boolean(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

export const CombatSchema = z.object({
  active: z.boolean(),
  round: z.number().int().min(0).max(100000),
  /** Whose turn it is. */
  currentId: IdSchema.nullable(),
  /** Turn order, first acts first. */
  combatants: z.array(CombatantSchema).max(200),
});
export type Combat = z.infer<typeof CombatSchema>;

export const EMPTY_COMBAT: Combat = { active: false, round: 0, currentId: null, combatants: [] };

// ---------------------------------------------------------------- area templates

export const TemplateKindSchema = z.enum(['circle', 'cone', 'line', 'square']);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;

export const TemplateSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  authorId: IdSchema,
  kind: TemplateKindSchema,
  /** Origin in scene pixels (center of circles/squares, apex of cones/lines). */
  x: CoordSchema,
  y: CoordSchema,
  /** Radius (circle), length (cone/line) or half-side (square), in grid cells. */
  size: z.number().min(0.5).max(200),
  /** Direction in radians (cone/line). */
  angle: z.number().min(-10).max(10),
  /** Cone spread in degrees (90 for PF1e/3.5 grids, ~53 for 5e). */
  coneAngle: z.number().min(10).max(180),
  /** Line width in grid cells. */
  width: z.number().min(0.5).max(20),
  color: ColorSchema,
});
export type Template = z.infer<typeof TemplateSchema>;

// ---------------------------------------------------------------- handouts

export const HandoutSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(120),
  imageUrl: AssetUrlSchema.nullable(),
  text: z.string().max(20000),
  /** gm: only the GM; all: everyone; some: the listed users. */
  share: z.enum(['gm', 'all', 'some']),
  sharedWith: z.array(IdSchema).max(50),
  createdAt: z.number(),
});
export type Handout = z.infer<typeof HandoutSchema>;

// ---------------------------------------------------------------- saved rolls

export const MacroSchema = z.object({
  id: IdSchema,
  ownerId: IdSchema,
  name: z.string().trim().min(1).max(40),
  formula: z.string().trim().min(1).max(200),
});
export type Macro = z.infer<typeof MacroSchema>;

// ---------------------------------------------------------------- audio

export const AudioTrackSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  url: AssetUrlSchema,
  volume: z.number().min(0).max(1),
  loop: z.boolean(),
  /** Server time the track started playing; null when stopped. */
  startedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type AudioTrack = z.infer<typeof AudioTrackSchema>;

// ---------------------------------------------------------------- rollable tables

export const TableEntrySchema = z.object({
  id: IdSchema,
  text: z.string().trim().min(1).max(500),
  weight: z.number().int().min(1).max(1000),
});
export type TableEntry = z.infer<typeof TableEntrySchema>;

export const RollTableSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  entries: z.array(TableEntrySchema).max(500),
  playersCanRoll: z.boolean(),
});
export type RollTable = z.infer<typeof RollTableSchema>;

// ---------------------------------------------------------------- card decks

export const CardSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  imageUrl: AssetUrlSchema.nullable(),
  text: z.string().max(2000),
});
export type Card = z.infer<typeof CardSchema>;

export const DrawnCardSchema = z.object({
  cardId: IdSchema,
  userId: IdSchema,
  /** Face-down cards are only shown to the drawer and the GM. */
  faceUp: z.boolean(),
  ts: z.number(),
});
export type DrawnCard = z.infer<typeof DrawnCardSchema>;

export const DeckSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  cards: z.record(IdSchema, CardSchema),
  /** Display order of cards in the editor. */
  cardOrder: z.array(IdSchema).max(500),
  /** Remaining cards, top first. Order is redacted (sorted) for players. */
  drawPile: z.array(IdSchema).max(500),
  drawn: z.array(DrawnCardSchema).max(500),
  discard: z.array(IdSchema).max(500),
  playersCanDraw: z.boolean(),
});
export type Deck = z.infer<typeof DeckSchema>;

// ---------------------------------------------------------------- chat attachments

/** A rich card attached to a chat message (table result, drawn card...). */
/** A d20 check a card offers as a button (a spell's concentration or caster level check). */
export const ChatCardRollSchema = z.object({
  label: z.string().trim().min(1).max(60),
  bonus: z.number().int().min(-100).max(200),
});

/** An area a card can place on the map (a spell's burst, cone or line), in feet. */
export const ChatCardAreaSchema = z.object({
  kind: TemplateKindSchema,
  feet: z.number().min(5).max(1000),
  /** Line width, feet. */
  widthFeet: z.number().min(5).max(100).optional(),
  label: z.string().max(60),
});
export type ChatCardArea = z.infer<typeof ChatCardAreaSchema>;

export const ChatCardSchema = z.object({
  title: z.string().max(120),
  subtitle: z.string().max(120).optional(),
  text: z.string().max(2000).optional(),
  imageUrl: AssetUrlSchema.nullable().optional(),
  rolls: z.array(ChatCardRollSchema).max(4).optional(),
  area: ChatCardAreaSchema.optional(),
});
export type ChatCard = z.infer<typeof ChatCardSchema>;

/** Restricted chat visibility. Absent = public. */
export const ChatWhisperSchema = z.object({
  /** gm: author + GMs. whisper: author + recipients. */
  mode: z.enum(['gm', 'whisper']),
  to: z.array(IdSchema).max(20),
});
export type ChatWhisper = z.infer<typeof ChatWhisperSchema>;
