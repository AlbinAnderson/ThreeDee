/**
 * GM handouts (an image and/or text) shared with everyone, nobody, or chosen
 * players. Unshared handouts never reach players: updates carry the full
 * handout to newly-allowed viewers, and redaction removes it when unshared.
 */
import { z } from 'zod';
import { defineAction, type Redactor } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import { HandoutSchema, IdSchema, type Handout, type User } from '../state';

export function canSeeHandout(user: User, h: Handout): boolean {
  return isGm(user) || h.share === 'all' || (h.share === 'some' && h.sharedWith.includes(user.id));
}

const HandoutChangesSchema = HandoutSchema.pick({ title: true, imageUrl: true, text: true, share: true, sharedWith: true }).partial();

export const handoutActions = {
  create: defineAction('handout/create', z.object({ handout: HandoutSchema }), {
    authorize: requireGm,
    audience: (viewer, { handout }) => canSeeHandout(viewer, handout),
    apply(draft, { handout }) {
      if (!draft.handouts[handout.id]) draft.handouts[handout.id] = handout;
    },
  }),

  update: defineAction(
    'handout/update',
    z.object({
      id: IdSchema,
      changes: HandoutChangesSchema,
      /** The whole handout after the change, filled in by the server. */
      full: HandoutSchema.optional(),
    }),
    {
      authorize: (ctx, { id }) => (requireGm(ctx) === true ? !!ctx.state.handouts[id] || 'Handout not found' : requireGm(ctx)),
      prepare(ctx, { id, changes }) {
        const full = { ...ctx.state.handouts[id]!, ...changes };
        return { id, changes, full };
      },
      // Tell everyone who could see it before (so it disappears) or can see it now (so it appears).
      audience: (viewer, { id, full }, { state }) => {
        const before = state.handouts[id];
        return (!!before && canSeeHandout(viewer, before)) || (!!full && canSeeHandout(viewer, full));
      },
      apply(draft, { id, changes, full }) {
        if (full) draft.handouts[id] = full;
        else if (draft.handouts[id]) Object.assign(draft.handouts[id]!, changes);
      },
    },
  ),

  remove: defineAction('handout/delete', z.object({ id: IdSchema }), {
    authorize: requireGm,
    audience: (viewer, { id }, { state }) => !!state.handouts[id] && canSeeHandout(viewer, state.handouts[id]!),
    apply(draft, { id }) {
      delete draft.handouts[id];
    },
  }),
};

export const redactHandouts: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const h of Object.values(draft.handouts)) if (!canSeeHandout(viewer, h)) delete draft.handouts[h.id];
};
