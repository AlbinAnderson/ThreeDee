import { z } from 'zod';
import { defineAction, type AuthContext, type AuthResult } from '../actions/define';
import { isGm } from '../actions/auth';
import { DrawingSchema, IdSchema, type Drawing, type User } from '../state';

export function canDeleteDrawing(user: User, drawing: Drawing): boolean {
  return isGm(user) || drawing.authorId === user.id;
}

function requireDrawableScene(ctx: AuthContext, sceneId: string): AuthResult {
  if (!ctx.state.scenes[sceneId]) return 'Scene not found';
  if (!isGm(ctx.user) && sceneId !== ctx.state.activeSceneId) return 'Players can only draw on the active scene';
  return true;
}

export const drawingActions = {
  create: defineAction('drawing/create', z.object({ drawing: DrawingSchema }), {
    authorize(ctx, { drawing }) {
      if (drawing.authorId !== ctx.user.id) return 'Drawings must be authored by yourself';
      return requireDrawableScene(ctx, drawing.sceneId);
    },
    apply(draft, { drawing }) {
      if (!draft.scenes[drawing.sceneId] || draft.drawings[drawing.id]) return;
      draft.drawings[drawing.id] = drawing;
    },
  }),

  remove: defineAction('drawing/delete', z.object({ id: IdSchema }), {
    authorize(ctx, { id }) {
      const d = ctx.state.drawings[id];
      if (!d) return 'Drawing not found';
      return canDeleteDrawing(ctx.user, d) || 'You can only erase your own drawings';
    },
    apply(draft, { id }) {
      delete draft.drawings[id];
    },
  }),

  /** Clear a scene's drawings: only `authorId`'s, or everyone's (GM only) when omitted. */
  clear: defineAction('drawing/clear', z.object({ sceneId: IdSchema, authorId: IdSchema.optional() }), {
    authorize(ctx, { sceneId, authorId }) {
      if (!ctx.state.scenes[sceneId]) return 'Scene not found';
      if (isGm(ctx.user) || authorId === ctx.user.id) return true;
      return 'Only the GM can clear everyone’s drawings';
    },
    apply(draft, { sceneId, authorId }) {
      for (const d of Object.values(draft.drawings)) {
        if (d.sceneId === sceneId && (!authorId || d.authorId === authorId)) delete draft.drawings[d.id];
      }
      // Templates are markings too: "clear" removes them as well.
      for (const t of Object.values(draft.templates)) {
        if (t.sceneId === sceneId && (!authorId || t.authorId === authorId)) delete draft.templates[t.id];
      }
    },
  }),
};
