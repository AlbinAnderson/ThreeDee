import { z } from 'zod';
import { defineAction, type AuthContext, type AuthResult } from '../actions/define';
import { canControlToken, isGm } from '../actions/auth';
import { IdSchema, TokenSchema } from '../state';
import { blockingSegments, isPathBlocked } from '../visibility';
import { removeCombatant } from './combat';
import { unlinkToken } from './pf1e/characters';

const CoordSchema = TokenSchema.shape.x;

/** Fields an owner may change on their own token. */
const OwnerEditableSchema = TokenSchema.pick({
  name: true,
  imageUrl: true,
  color: true,
  size: true,
  showName: true,
  hp: true,
  hpVisible: true,
  conditions: true,
  darkvision: true,
  light: true,
});
/** Fields only the GM may change. */
const GmEditableSchema = TokenSchema.pick({ ownerIds: true, hidden: true });

const TokenChangesSchema = OwnerEditableSchema.extend(GmEditableSchema.shape).partial();

function requireTokenControl(ctx: AuthContext, id: string): AuthResult {
  const token = ctx.state.tokens[id];
  if (!token) return 'Token not found';
  return canControlToken(ctx.user, token) || "You don't control that token";
}

export const tokenActions = {
  create: defineAction('token/create', z.object({ token: TokenSchema }), {
    authorize(ctx, { token }) {
      if (!ctx.state.scenes[token.sceneId]) return 'Scene not found';
      if (isGm(ctx.user)) return true;
      if (token.sceneId !== ctx.state.activeSceneId) return 'Players can only add tokens to the active scene';
      if (token.hidden) return 'Players cannot create hidden tokens';
      if (token.ownerIds.length !== 1 || token.ownerIds[0] !== ctx.user.id)
        return 'Players can only create tokens they own';
      return true;
    },
    apply(draft, { token }) {
      if (!draft.scenes[token.sceneId] || draft.tokens[token.id]) return;
      draft.tokens[token.id] = token;
    },
  }),

  move: defineAction('token/move', z.object({ id: IdSchema, x: CoordSchema, y: CoordSchema }), {
    authorize(ctx, { id, x, y }) {
      const control = requireTokenControl(ctx, id);
      if (control !== true || isGm(ctx.user)) return control;
      // Players can't walk through walls or closed doors.
      const token = ctx.state.tokens[id]!;
      const scene = ctx.state.scenes[token.sceneId];
      if (!scene) return true;
      const walls = Object.values(ctx.state.walls).filter((w) => w.sceneId === scene.id);
      if (!walls.length) return true;
      const half = (token.size * scene.grid.size) / 2;
      const from = { x: token.x + half, y: token.y + half };
      const to = { x: x + half, y: y + half };
      return !isPathBlocked(from, to, blockingSegments(walls)) || 'Blocked by a wall';
    },
    apply(draft, { id, x, y }) {
      const token = draft.tokens[id];
      if (!token) return;
      token.x = x;
      token.y = y;
    },
  }),

  update: defineAction('token/update', z.object({ id: IdSchema, changes: TokenChangesSchema }), {
    authorize(ctx, { id, changes }) {
      const control = requireTokenControl(ctx, id);
      if (control !== true) return control;
      if (!isGm(ctx.user) && Object.keys(GmEditableSchema.shape).some((k) => k in changes))
        return 'Only the GM can change ownership or visibility';
      return true;
    },
    apply(draft, { id, changes }) {
      const token = draft.tokens[id];
      if (!token) return;
      Object.assign(token, changes);
      // Keep the turn tracker's stored name in step (it's used if the token is later deleted).
      if (changes.name !== undefined) {
        for (const c of draft.combat.combatants) if (c.tokenId === id) c.name = token.name.trim() || 'Token';
      }
    },
  }),

  remove: defineAction('token/delete', z.object({ id: IdSchema }), {
    authorize: (ctx, { id }) => requireTokenControl(ctx, id),
    apply(draft, { id }) {
      delete draft.tokens[id];
      // A deleted token leaves the turn order too, and characters lose their link to it.
      for (const c of [...draft.combat.combatants]) if (c.tokenId === id) removeCombatant(draft.combat, c.id);
      unlinkToken(draft, id);
    },
  }),
};
