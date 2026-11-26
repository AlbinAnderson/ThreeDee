/** Basic schemas shared by every entity definition. */
import { z } from 'zod';

export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');

export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb color');

/** Images/audio may be server-uploaded assets or external http(s) URLs. */
export const AssetUrlSchema = z
  .string()
  .max(2048)
  .refine((s) => s.startsWith('/assets/') || /^https?:\/\//i.test(s), 'Must be an uploaded asset or http(s) URL');

/** A coordinate in scene pixels. */
export const CoordSchema = z.number().min(-100000).max(100000);

export const PointSchema = z.object({ x: CoordSchema, y: CoordSchema });
