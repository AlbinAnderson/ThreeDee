/** Fog of war, walls/doors, lights and per-scene vision settings. */
import { z } from 'zod';
import { ColorSchema, CoordSchema, IdSchema } from '../primitives';

// ---------------------------------------------------------------- manual fog

export const FOG_MAX_OPS = 3000;

/**
 * One brush stroke of the GM's fog painting. Ops are applied in order on top
 * of a fully fogged scene: `reveal` cuts holes, `hide` paints fog back.
 */
export const FogOpSchema = z.object({
  id: IdSchema,
  mode: z.enum(['reveal', 'hide']),
  /** `all` covers the whole scene (used by "reveal all"). */
  shape: z.enum(['rect', 'ellipse', 'brush', 'all']),
  /** Flat [x0, y0, x1, y1, ...]. rect/ellipse use two corners; brush is a path. */
  points: z.array(CoordSchema).max(10000),
  /** Brush diameter in scene pixels. */
  width: z.number().min(1).max(2000),
});
export type FogOp = z.infer<typeof FogOpSchema>;

export const FogSchema = z.object({
  enabled: z.boolean(),
  ops: z.array(FogOpSchema).max(FOG_MAX_OPS),
});
export type Fog = z.infer<typeof FogSchema>;

// ---------------------------------------------------------------- vision

export const VisionSettingsSchema = z.object({
  /** Players only see what their tokens have line of sight to. */
  enabled: z.boolean(),
  /** Unlit areas are dark: players need a light or darkvision to see them. */
  dark: z.boolean(),
});
export type VisionSettings = z.infer<typeof VisionSettingsSchema>;

/** A wall segment. Doors are walls that can be opened. */
export const WallSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  /** [x1, y1, x2, y2] in scene pixels. */
  points: z.tuple([CoordSchema, CoordSchema, CoordSchema, CoordSchema]),
  /** null = plain wall. Locked doors can only be opened by the GM. */
  door: z.enum(['closed', 'open', 'locked']).nullable(),
});
export type Wall = z.infer<typeof WallSchema>;

/** Light radii in grid cells. Everything within `dim` is visible; within `bright` is fully lit. */
export const LightEmissionSchema = z.object({
  bright: z.number().min(0).max(200),
  dim: z.number().min(0).max(400),
  color: ColorSchema,
});
export type LightEmission = z.infer<typeof LightEmissionSchema>;

/** A light placed on the map (torch sconce, campfire...). Tokens can also carry light. */
export const LightSchema = LightEmissionSchema.extend({
  id: IdSchema,
  sceneId: IdSchema,
  x: CoordSchema,
  y: CoordSchema,
});
export type Light = z.infer<typeof LightSchema>;
