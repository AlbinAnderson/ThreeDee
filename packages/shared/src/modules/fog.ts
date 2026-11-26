/** GM-painted fog of war, per scene. */
import { z } from 'zod';
import { defineAction, type AuthContext, type AuthResult } from '../actions/define';
import { requireGm } from '../actions/auth';
import { FOG_MAX_OPS, FogOpSchema, IdSchema } from '../state';

function requireGmScene(ctx: AuthContext, sceneId: string): AuthResult {
  const gm = requireGm(ctx);
  if (gm !== true) return gm;
  return ctx.state.scenes[sceneId] ? true : 'Scene not found';
}

export const fogActions = {
  setEnabled: defineAction('fog/setEnabled', z.object({ sceneId: IdSchema, enabled: z.boolean() }), {
    authorize: (ctx, { sceneId }) => requireGmScene(ctx, sceneId),
    apply(draft, { sceneId, enabled }) {
      const scene = draft.scenes[sceneId];
      if (scene) scene.fog.enabled = enabled;
    },
  }),

  /** Paint one reveal/hide stroke. */
  add: defineAction('fog/add', z.object({ sceneId: IdSchema, op: FogOpSchema }), {
    authorize(ctx, { sceneId }) {
      const ok = requireGmScene(ctx, sceneId);
      if (ok !== true) return ok;
      if (ctx.state.scenes[sceneId]!.fog.ops.length >= FOG_MAX_OPS)
        return 'Too many fog strokes on this scene. Use "Reveal all" or "Cover all" to start over.';
      return true;
    },
    apply(draft, { sceneId, op }) {
      draft.scenes[sceneId]?.fog.ops.push(op);
    },
  }),

  undo: defineAction('fog/undo', z.object({ sceneId: IdSchema }), {
    authorize: (ctx, { sceneId }) => requireGmScene(ctx, sceneId),
    apply(draft, { sceneId }) {
      draft.scenes[sceneId]?.fog.ops.pop();
    },
  }),

  /** Start over: everything covered, or everything revealed. */
  reset: defineAction('fog/reset', z.object({ sceneId: IdSchema, to: z.enum(['covered', 'revealed']), opId: IdSchema }), {
    authorize: (ctx, { sceneId }) => requireGmScene(ctx, sceneId),
    apply(draft, { sceneId, to, opId }) {
      const scene = draft.scenes[sceneId];
      if (!scene) return;
      scene.fog.ops = to === 'revealed' ? [{ id: opId, mode: 'reveal', shape: 'all', points: [], width: 1 }] : [];
    },
  }),
};
