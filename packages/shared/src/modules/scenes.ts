import { z } from 'zod';
import { defineAction } from '../actions/define';
import { requireGm } from '../actions/auth';
import { GridSettingsSchema, IdSchema, SceneSchema } from '../state';
import { removeCombatant } from './combat';
import { unlinkToken } from './pf1e/characters';

/** Fog has its own actions (it's large and painted incrementally). */
const SceneChangesSchema = SceneSchema.omit({ id: true, grid: true, fog: true }).partial();

export const sceneActions = {
  create: defineAction('scene/create', z.object({ scene: SceneSchema }), {
    authorize: requireGm,
    apply(draft, { scene }) {
      if (draft.scenes[scene.id]) return;
      draft.scenes[scene.id] = scene;
      draft.sceneOrder.push(scene.id);
      draft.activeSceneId ??= scene.id;
    },
  }),

  update: defineAction('scene/update', z.object({ id: IdSchema, changes: SceneChangesSchema }), {
    authorize: requireGm,
    apply(draft, { id, changes }) {
      const scene = draft.scenes[id];
      if (scene) Object.assign(scene, changes);
    },
  }),

  updateGrid: defineAction(
    'scene/updateGrid',
    z.object({ id: IdSchema, changes: GridSettingsSchema.partial() }),
    {
      authorize: requireGm,
      apply(draft, { id, changes }) {
        const scene = draft.scenes[id];
        if (scene) Object.assign(scene.grid, changes);
      },
    },
  ),

  remove: defineAction('scene/delete', z.object({ id: IdSchema }), {
    authorize: requireGm,
    apply(draft, { id }) {
      if (!draft.scenes[id]) return;
      delete draft.scenes[id];
      draft.sceneOrder = draft.sceneOrder.filter((s) => s !== id);
      for (const token of Object.values(draft.tokens)) {
        if (token.sceneId === id) {
          delete draft.tokens[token.id];
          // Same cleanup as deleting the token directly.
          for (const c of [...draft.combat.combatants]) if (c.tokenId === token.id) removeCombatant(draft, c.id);
          unlinkToken(draft, token.id);
        }
      }
      if (draft.activeSceneId === id) draft.activeSceneId = draft.sceneOrder[0] ?? null;
    },
  }),

  /** Move all players to a scene. */
  activate: defineAction('scene/activate', z.object({ id: IdSchema }), {
    authorize: requireGm,
    apply(draft, { id }) {
      if (draft.scenes[id]) draft.activeSceneId = id;
    },
  }),

  reorder: defineAction('scene/reorder', z.object({ order: z.array(IdSchema).max(1000) }), {
    authorize: requireGm,
    apply(draft, { order }) {
      const known = order.filter((id) => draft.scenes[id]);
      const missing = draft.sceneOrder.filter((id) => !known.includes(id));
      draft.sceneOrder = [...new Set([...known, ...missing])];
    },
  }),
};
