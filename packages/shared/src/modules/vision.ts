/** Walls, doors and placed lights. Scene-level vision settings live on the scene (scene/update). */
import { z } from 'zod';
import { defineAction } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import { IdSchema, LightSchema, WallSchema } from '../state';

const LightChangesSchema = LightSchema.pick({ x: true, y: true, bright: true, dim: true, color: true }).partial();

export const wallActions = {
  /** Add one or more wall segments. */
  add: defineAction('walls/add', z.object({ walls: z.array(WallSchema).min(1).max(500) }), {
    authorize(ctx, { walls }) {
      const gm = requireGm(ctx);
      if (gm !== true) return gm;
      return walls.every((w) => ctx.state.scenes[w.sceneId]) || 'Scene not found';
    },
    apply(draft, { walls }) {
      for (const w of walls) if (draft.scenes[w.sceneId] && !draft.walls[w.id]) draft.walls[w.id] = w;
    },
  }),

  remove: defineAction('walls/remove', z.object({ ids: z.array(IdSchema).min(1).max(5000) }), {
    authorize: requireGm,
    apply(draft, { ids }) {
      for (const id of ids) delete draft.walls[id];
    },
  }),

  /** Open/close a door. Players can use unlocked doors; only the GM can lock/unlock. */
  setDoor: defineAction('walls/setDoor', z.object({ id: IdSchema, door: z.enum(['closed', 'open', 'locked']) }), {
    authorize(ctx, { id, door }) {
      const wall = ctx.state.walls[id];
      if (!wall || wall.door === null) return 'Not a door';
      if (isGm(ctx.user)) return true;
      if (wall.door === 'locked') return 'The door is locked';
      if (door === 'locked') return 'Only the GM can lock doors';
      return true;
    },
    apply(draft, { id, door }) {
      const wall = draft.walls[id];
      if (wall && wall.door !== null) wall.door = door;
    },
  }),

  /** Remove every wall (and light) on a scene. */
  clearScene: defineAction('walls/clearScene', z.object({ sceneId: IdSchema, lights: z.boolean() }), {
    authorize: requireGm,
    apply(draft, { sceneId, lights }) {
      for (const w of Object.values(draft.walls)) if (w.sceneId === sceneId) delete draft.walls[w.id];
      if (lights) for (const l of Object.values(draft.lights)) if (l.sceneId === sceneId) delete draft.lights[l.id];
    },
  }),
};

export const lightActions = {
  add: defineAction('lights/add', z.object({ light: LightSchema }), {
    authorize: (ctx, { light }) => (requireGm(ctx) === true ? !!ctx.state.scenes[light.sceneId] || 'Scene not found' : requireGm(ctx)),
    apply(draft, { light }) {
      if (draft.scenes[light.sceneId] && !draft.lights[light.id]) draft.lights[light.id] = light;
    },
  }),

  update: defineAction('lights/update', z.object({ id: IdSchema, changes: LightChangesSchema }), {
    authorize: requireGm,
    apply(draft, { id, changes }) {
      const light = draft.lights[id];
      if (light) Object.assign(light, changes);
    },
  }),

  remove: defineAction('lights/remove', z.object({ id: IdSchema }), {
    authorize: requireGm,
    apply(draft, { id }) {
      delete draft.lights[id];
    },
  }),
};
