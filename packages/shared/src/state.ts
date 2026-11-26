/**
 * Canonical game-state shape. Every entity is described by a zod schema so the
 * same definition is used for TypeScript types, network validation and
 * validating persisted rooms on load.
 */
import { z } from 'zod';
import { RollResultSchema } from './dice';
import {
  AudioTrackSchema,
  ChatCardSchema,
  ChatWhisperSchema,
  CombatSchema,
  DeckSchema,
  EMPTY_COMBAT,
  HandoutSchema,
  MacroSchema,
  RollTableSchema,
  TemplateSchema,
} from './entities/play';
import { CharacterSchema, Pf1TurnStateSchema } from './entities/pf1e';
import { FogSchema, LightEmissionSchema, LightSchema, VisionSettingsSchema, WallSchema } from './entities/vision';
import { AssetUrlSchema, ColorSchema, IdSchema } from './primitives';

export * from './primitives';
export * from './entities/play';
export * from './entities/vision';
export * from './entities/pf1e';

/** Bump when the shape changes, and add a step in migrations.ts. */
export const CURRENT_SCHEMA_VERSION = 11;

// ---------------------------------------------------------------- users

export const RoleSchema = z.enum(['gm', 'player']);
export type Role = z.infer<typeof RoleSchema>;

export const UserNameSchema = z.string().trim().min(1).max(40);

export const UserSchema = z.object({
  id: IdSchema,
  name: UserNameSchema,
  role: RoleSchema,
  color: ColorSchema,
});
export type User = z.infer<typeof UserSchema>;
export type UserId = User['id'];

// ---------------------------------------------------------------- scenes

/**
 * How diagonal movement is counted when measuring on a square grid.
 *  - chebyshev:   every diagonal costs 1 (5e default)
 *  - alternating: 1-2-1-2 (Pathfinder / 3.5 "5-10-5")
 *  - manhattan:   no diagonals, dx + dy
 *  - euclidean:   true straight-line distance
 */
export const DiagonalRuleSchema = z.enum(['chebyshev', 'alternating', 'manhattan', 'euclidean']);
export type DiagonalRule = z.infer<typeof DiagonalRuleSchema>;

export const GridSettingsSchema = z.object({
  type: z.enum(['square', 'none']),
  /** Pixel size of one cell in scene (world) coordinates. */
  size: z.number().min(8).max(500),
  offsetX: z.number().min(-500).max(500),
  offsetY: z.number().min(-500).max(500),
  color: ColorSchema,
  opacity: z.number().min(0).max(1),
  unitsPerCell: z.number().min(0).max(10000),
  unitLabel: z.string().max(12),
  diagonals: DiagonalRuleSchema,
  snap: z.boolean(),
});
export type GridSettings = z.infer<typeof GridSettingsSchema>;

export const SceneSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  width: z.number().min(100).max(30000),
  height: z.number().min(100).max(30000),
  background: AssetUrlSchema.nullable(),
  backgroundColor: ColorSchema,
  grid: GridSettingsSchema,
  /** GM-painted fog of war. */
  fog: FogSchema,
  /** Line of sight / lighting for players. */
  vision: VisionSettingsSchema,
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------------------------------------------------------------- tokens

export const TokenSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  name: z.string().trim().max(60),
  imageUrl: AssetUrlSchema.nullable(),
  color: ColorSchema,
  /** Top-left corner in scene pixels. */
  x: z.number().min(-100000).max(100000),
  y: z.number().min(-100000).max(100000),
  /** Footprint in grid cells (1 = one square). */
  size: z.number().min(0.25).max(20),
  /** Users (besides the GM) allowed to move/edit this token. */
  ownerIds: z.array(IdSchema).max(50),
  /** Hidden tokens are only rendered for the GM. */
  hidden: z.boolean(),
  showName: z.boolean(),
  /** Hit points (generic: any "health" track). null = no bar. */
  hp: z
    .object({
      value: z.number().int().min(-100000).max(100000),
      max: z.number().int().min(0).max(100000),
      temp: z.number().int().min(0).max(100000),
    })
    .nullable(),
  /** Whether players who don't own the token can see its HP bar. */
  hpVisible: z.boolean(),
  /** Status markers ("prone", "shaken", or anything custom). */
  conditions: z.array(z.string().trim().min(1).max(40)).max(30),
  /** Rounds left on some of those conditions (by name); they count down at the start of the token's turn in combat. */
  conditionRounds: z
    .record(z.string().trim().min(1).max(40), z.number().int().min(1).max(10000))
    .refine((r) => Object.keys(r).length <= 30, 'Too many condition timers'),
  /** Darkvision range in grid cells (0 = none). */
  darkvision: z.number().min(0).max(200),
  /** Light the token carries (torch, lantern). */
  light: LightEmissionSchema.nullable(),
});
export type Token = z.infer<typeof TokenSchema>;

/** A token with default values for everything not given. */
export function createToken(fields: Pick<Token, 'id' | 'sceneId' | 'x' | 'y'> & Partial<Token>): Token {
  return {
    name: 'Token',
    imageUrl: null,
    color: '#888888',
    size: 1,
    ownerIds: [],
    hidden: false,
    showName: true,
    hp: null,
    hpVisible: false,
    conditions: [],
    conditionRounds: {},
    darkvision: 0,
    light: null,
    ...fields,
  };
}

// ---------------------------------------------------------------- drawings

const DrawCoordSchema = z.number().min(-100000).max(100000);

export const DrawingShapeSchema = z.enum(['freehand', 'line', 'rect', 'ellipse']);
export type DrawingShape = z.infer<typeof DrawingShapeSchema>;

export const DRAWING_MAX_COORDS = 10000;

export const DrawingSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  authorId: IdSchema,
  shape: DrawingShapeSchema,
  /**
   * Flat [x0, y0, x1, y1, ...] in scene pixels. Freehand uses every point;
   * line/rect/ellipse use the first two points (start and end corners).
   */
  points: z.array(DrawCoordSchema).min(4).max(DRAWING_MAX_COORDS),
  color: ColorSchema,
  width: z.number().min(1).max(100),
  fill: z.boolean(),
});
export type Drawing = z.infer<typeof DrawingSchema>;

// ---------------------------------------------------------------- notes

export const NOTE_MAX_LENGTH = 50000;

/** A player's private notepad (visible to its owner and the GM). */
export const NoteSchema = z.object({
  text: z.string().max(NOTE_MAX_LENGTH),
  updatedAt: z.number(),
});
export type Note = z.infer<typeof NoteSchema>;

// ---------------------------------------------------------------- loot

export const LootItemSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  imageUrl: AssetUrlSchema.nullable(),
  quantity: z.number().int().min(0).max(1_000_000),
  /** Free text so any currency/system works ("250 gp", "3 gems"). */
  value: z.string().trim().max(60),
  /** User carrying it, or null for the party stash. */
  holderId: IdSchema.nullable(),
  /** Party notes: what we think it does. Anyone can edit. */
  notes: z.string().max(10000),
  /** Once true, `secretNotes` is revealed to players. */
  identified: z.boolean(),
  /** GM-only true properties. Redacted for players until identified. */
  secretNotes: z.string().max(10000),
  /** Moved whole into a character's inventory: hidden from the Loot list, kept for the GM's true properties. */
  stowed: z.boolean(),
  createdBy: IdSchema,
  createdAt: z.number(),
});
export type LootItem = z.infer<typeof LootItemSchema>;

// ---------------------------------------------------------------- chat

export const ChatMessageSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  ts: z.number(),
  text: z.string().max(2000),
  roll: RollResultSchema.optional(),
  card: ChatCardSchema.optional(),
  /** Restricted visibility (GM-only roll or whisper). Absent = public. */
  whisper: ChatWhisperSchema.optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CHAT_HISTORY_LIMIT = 500;

// ---------------------------------------------------------------- root

export const GameStateSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  users: z.record(IdSchema, UserSchema),
  scenes: z.record(IdSchema, SceneSchema),
  sceneOrder: z.array(IdSchema),
  /** The scene players are looking at. */
  activeSceneId: IdSchema.nullable(),
  tokens: z.record(IdSchema, TokenSchema),
  drawings: z.record(IdSchema, DrawingSchema),
  chat: z.array(ChatMessageSchema),
  notes: z.record(IdSchema, NoteSchema),
  loot: z.record(IdSchema, LootItemSchema),
  walls: z.record(IdSchema, WallSchema),
  lights: z.record(IdSchema, LightSchema),
  templates: z.record(IdSchema, TemplateSchema),
  combat: CombatSchema,
  handouts: z.record(IdSchema, HandoutSchema),
  macros: z.record(IdSchema, MacroSchema),
  audio: z.record(IdSchema, AudioTrackSchema),
  tables: z.record(IdSchema, RollTableSchema),
  decks: z.record(IdSchema, DeckSchema),
  /** PF1e characters (imported from PCGen). */
  characters: z.record(IdSchema, CharacterSchema),
  /** PF1e action economy per combatant id. */
  pf1eTurns: z.record(IdSchema, Pf1TurnStateSchema),
});
export type GameState = z.infer<typeof GameStateSchema>;

export const DEFAULT_GRID: GridSettings = {
  type: 'square',
  size: 70,
  offsetX: 0,
  offsetY: 0,
  color: '#000000',
  opacity: 0.35,
  unitsPerCell: 5,
  unitLabel: 'ft',
  diagonals: 'chebyshev',
  snap: true,
};

export function createScene(id: string, name = 'New Scene'): Scene {
  return {
    id,
    name,
    width: DEFAULT_GRID.size * 30,
    height: DEFAULT_GRID.size * 20,
    background: null,
    backgroundColor: '#3a3d42',
    grid: { ...DEFAULT_GRID },
    fog: { enabled: false, ops: [] },
    vision: { enabled: false, dark: false },
  };
}

export function createInitialState(firstSceneId: string): GameState {
  const scene = createScene(firstSceneId, 'Scene 1');
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    users: {},
    scenes: { [scene.id]: scene },
    sceneOrder: [scene.id],
    activeSceneId: scene.id,
    tokens: {},
    drawings: {},
    chat: [],
    notes: {},
    loot: {},
    walls: {},
    lights: {},
    templates: {},
    combat: structuredClone(EMPTY_COMBAT),
    handouts: {},
    macros: {},
    audio: {},
    tables: {},
    decks: {},
    characters: {},
    pf1eTurns: {},
  };
}
