/**
 * Canonical game-state shape. Every entity is described by a zod schema so the
 * same definition is used for TypeScript types, network validation and
 * validating persisted rooms on load.
 */
import { z } from 'zod';
import { RollResultSchema } from './dice';

export const CURRENT_SCHEMA_VERSION = 1;

export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');

export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb color');

/** Images may be server-uploaded assets or external http(s) URLs. */
export const AssetUrlSchema = z
  .string()
  .max(2048)
  .refine((s) => s.startsWith('/assets/') || /^https?:\/\//i.test(s), 'Must be an uploaded asset or http(s) URL');

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
});
export type Token = z.infer<typeof TokenSchema>;

// ---------------------------------------------------------------- chat

export const ChatMessageSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  ts: z.number(),
  text: z.string().max(2000),
  roll: RollResultSchema.optional(),
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
  chat: z.array(ChatMessageSchema),
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
    chat: [],
  };
}
