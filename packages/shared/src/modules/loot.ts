/**
 * Party loot. Anyone can record items and edit the shared fields; the GM
 * additionally keeps secret "true properties" per item, which players only
 * receive once the GM marks the item identified.
 */
import { z } from 'zod';
import { defineAction, type AuthContext, type AuthResult, type Redactor } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import { IdSchema, LootItemSchema } from '../state';

const SharedFieldsSchema = LootItemSchema.pick({
  name: true,
  imageUrl: true,
  quantity: true,
  value: true,
  holderId: true,
  notes: true,
});

function requireItem(ctx: AuthContext, id: string): AuthResult {
  return ctx.state.loot[id] ? true : 'Item not found';
}

function requireValidHolder(ctx: AuthContext, holderId: string | null | undefined): AuthResult {
  if (holderId && !ctx.state.users[holderId]) return 'Unknown holder';
  return true;
}

export const lootActions = {
  create: defineAction('loot/create', z.object({ id: IdSchema, item: SharedFieldsSchema }), {
    authorize: (ctx, { item }) => requireValidHolder(ctx, item.holderId),
    apply(draft, { id, item }, meta) {
      if (draft.loot[id]) return;
      draft.loot[id] = { ...item, id, identified: false, secretNotes: '', stowed: false, createdBy: meta.userId, createdAt: meta.ts };
    },
  }),

  update: defineAction('loot/update', z.object({ id: IdSchema, changes: SharedFieldsSchema.partial() }), {
    authorize(ctx, { id, changes }) {
      const ok = requireItem(ctx, id);
      if (ok !== true) return ok;
      if (ctx.state.loot[id]!.stowed) return 'Item is stowed in an inventory';
      return requireValidHolder(ctx, changes.holderId);
    },
    apply(draft, { id, changes }) {
      const item = draft.loot[id];
      if (item && !item.stowed) Object.assign(item, changes);
    },
  }),

  /** GM edits the item's true properties. Players only receive this once the item is identified. */
  setSecret: defineAction(
    'loot/setSecret',
    z.object({ id: IdSchema, secretNotes: LootItemSchema.shape.secretNotes }),
    {
      authorize: (ctx, { id }) => (requireGm(ctx) === true ? requireItem(ctx, id) : requireGm(ctx)),
      audience: (viewer, { id }, { state }) => isGm(viewer) || !!state.loot[id]?.identified,
      apply(draft, { id, secretNotes }) {
        const item = draft.loot[id];
        if (item) item.secretNotes = secretNotes;
      },
    },
  ),

  /** Identifying an item reveals its true properties to everyone. */
  setIdentified: defineAction(
    'loot/setIdentified',
    z.object({
      id: IdSchema,
      identified: z.boolean(),
      /** Filled in by the server when identifying; ignored from clients. */
      secretNotes: LootItemSchema.shape.secretNotes.optional(),
    }),
    {
      authorize: (ctx, { id }) => (requireGm(ctx) === true ? requireItem(ctx, id) : requireGm(ctx)),
      prepare(ctx, payload) {
        const secretNotes = payload.identified ? ctx.state.loot[payload.id]?.secretNotes : undefined;
        return { id: payload.id, identified: payload.identified, secretNotes };
      },
      apply(draft, { id, identified, secretNotes }) {
        const item = draft.loot[id];
        if (!item) return;
        item.identified = identified;
        if (secretNotes !== undefined) item.secretNotes = secretNotes;
      },
    },
  ),

  remove: defineAction('loot/delete', z.object({ id: IdSchema }), {
    authorize(ctx, { id }) {
      const item = ctx.state.loot[id];
      if (!item) return 'Item not found';
      if (item.stowed && !isGm(ctx.user)) return 'Only the GM can delete a stowed loot record';
      return isGm(ctx.user) || item.createdBy === ctx.user.id || 'Only the GM or whoever added it can delete this';
    },
    apply(draft, { id }) {
      delete draft.loot[id];
    },
  }),
};

export const redactLoot: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const item of Object.values(draft.loot)) {
    if (!item.identified) item.secretNotes = '';
  }
};
