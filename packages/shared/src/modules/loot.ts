/**
 * Party loot. Anyone can record items and edit the shared fields; the GM
 * additionally keeps secret "true properties" per item (true name, value,
 * caster level, description), which players only receive once the GM marks
 * the item identified. Detect magic (`magicDetected`) reveals just the caster
 * level, so players know the Spellcraft DC (15 + CL).
 */
import { z } from 'zod';
import { defineAction, type AuthContext, type AuthResult, type Redactor } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import { IdSchema, LootItemSchema, type LootItem } from '../state';
import { parseGpValue } from './pf1e/inventory';

const SharedFieldsSchema = LootItemSchema.pick({
  name: true,
  imageUrl: true,
  quantity: true,
  value: true,
  holderId: true,
  notes: true,
});

const SecretFieldsSchema = LootItemSchema.pick({ trueName: true, secretValue: true, secretNotes: true, cl: true });
type SecretFields = z.infer<typeof SecretFieldsSchema>;

function requireItem(ctx: AuthContext, id: string): AuthResult {
  return ctx.state.loot[id] ? true : 'Item not found';
}

function requireValidHolder(ctx: AuthContext, holderId: string | null | undefined): AuthResult {
  if (holderId && !ctx.state.users[holderId]) return 'Unknown holder';
  return true;
}

const requireGmItem = (ctx: AuthContext, id: string): AuthResult => (requireGm(ctx) === true ? requireItem(ctx, id) : requireGm(ctx));

/** Spellcraft DC to identify a magic item (Core Rulebook: 15 + caster level). */
export const identifyDc = (cl: number) => 15 + cl;

/** Whether a viewer may see the item's caster level. */
export const canSeeCl = (viewer: { role: string }, item: Pick<LootItem, 'identified' | 'magicDetected'>) =>
  viewer.role === 'gm' || item.identified || item.magicDetected;

export const lootActions = {
  create: defineAction('loot/create', z.object({ id: IdSchema, item: SharedFieldsSchema }), {
    authorize: (ctx, { item }) => requireValidHolder(ctx, item.holderId),
    apply(draft, { id, item }, meta) {
      if (draft.loot[id]) return;
      draft.loot[id] = {
        ...item,
        id,
        identified: false,
        secretNotes: '',
        stowed: false,
        trueName: '',
        secretValue: '',
        cl: null,
        magicDetected: false,
        createdBy: meta.userId,
        createdAt: meta.ts,
      };
    },
  }),

  /**
   * GM: drop treasure into the party loot, unidentified, with its true
   * properties filled in. Players receive only the public side.
   */
  createTreasure: defineAction('loot/createTreasure', z.object({ id: IdSchema, item: SharedFieldsSchema, secret: SecretFieldsSchema }), {
    authorize(ctx, { id, item }) {
      const gm = requireGm(ctx);
      if (gm !== true) return gm;
      if (ctx.state.loot[id]) return 'Item already exists';
      return requireValidHolder(ctx, item.holderId);
    },
    redactPayload: (viewer, p) => (isGm(viewer) ? p : { ...p, secret: { trueName: '', secretValue: '', secretNotes: '', cl: null } }),
    apply(draft, { id, item, secret }, meta) {
      if (draft.loot[id]) return;
      draft.loot[id] = {
        ...item,
        ...secret,
        id,
        identified: false,
        stowed: false,
        magicDetected: false,
        createdBy: meta.userId,
        createdAt: meta.ts,
      };
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

  /**
   * GM edits the item's true properties. Players only receive this once the
   * item is identified (or just the caster level, once magic is detected).
   */
  setSecret: defineAction(
    'loot/setSecret',
    z.object({
      id: IdSchema,
      secretNotes: LootItemSchema.shape.secretNotes.optional(),
      trueName: LootItemSchema.shape.trueName.optional(),
      secretValue: LootItemSchema.shape.secretValue.optional(),
      cl: LootItemSchema.shape.cl.optional(),
    }),
    {
      authorize: (ctx, { id }) => requireGmItem(ctx, id),
      audience: (viewer, { id, cl }, { state }) => {
        const item = state.loot[id];
        return isGm(viewer) || !!item?.identified || (!!item?.magicDetected && cl !== undefined);
      },
      redactPayload: (viewer, p, { state }) => (isGm(viewer) || state.loot[p.id]?.identified ? p : { id: p.id, cl: p.cl }),
      apply(draft, { id, ...changes }) {
        const item = draft.loot[id];
        if (!item) return;
        for (const [k, v] of Object.entries(changes)) if (v !== undefined) (item as Record<string, unknown>)[k] = v;
      },
    },
  ),

  /** Identifying an item reveals its true properties to everyone (its true name and value replace the public ones). */
  setIdentified: defineAction(
    'loot/setIdentified',
    z.object({
      id: IdSchema,
      identified: z.boolean(),
      /** Filled in by the server when identifying; ignored from clients. */
      secretNotes: LootItemSchema.shape.secretNotes.optional(),
      secret: SecretFieldsSchema.optional(),
    }),
    {
      optimistic: false,
      authorize: (ctx, { id }) => requireGmItem(ctx, id),
      prepare(ctx, payload) {
        const item = ctx.state.loot[payload.id];
        if (!payload.identified || !item) return { id: payload.id, identified: payload.identified };
        const secret: SecretFields = { trueName: item.trueName, secretValue: item.secretValue, secretNotes: item.secretNotes, cl: item.cl };
        return { id: payload.id, identified: true, secretNotes: item.secretNotes, secret };
      },
      apply(draft, { id, identified, secretNotes, secret }) {
        const item = draft.loot[id];
        if (!item) return;
        item.identified = identified;
        if (secretNotes !== undefined) item.secretNotes = secretNotes;
        if (!identified || !secret) return;
        Object.assign(item, secret);
        if (secret.trueName) item.name = secret.trueName;
        if (secret.secretValue) item.value = secret.secretValue;
        // Pieces already taken into inventories learn their true name and value too.
        for (const c of Object.values(draft.characters)) {
          for (const i of c.inventory.items) {
            if (i.lootId !== id) continue;
            if (secret.trueName) i.name = secret.trueName;
            if (secret.secretValue) i.value = parseGpValue(secret.secretValue);
          }
        }
      },
    },
  ),

  /** GM: detect magic revealed the item's aura, so players see its caster level and identify DC. */
  setDetected: defineAction(
    'loot/setDetected',
    z.object({ id: IdSchema, detected: z.boolean(), cl: LootItemSchema.shape.cl.optional() }),
    {
      optimistic: false,
      authorize: (ctx, { id }) => requireGmItem(ctx, id),
      prepare: (ctx, { id, detected }) => ({ id, detected, cl: detected ? (ctx.state.loot[id]?.cl ?? null) : undefined }),
      apply(draft, { id, detected, cl }) {
        const item = draft.loot[id];
        if (!item) return;
        item.magicDetected = detected;
        if (cl !== undefined) item.cl = cl;
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
    if (item.identified) continue;
    item.secretNotes = '';
    item.trueName = '';
    item.secretValue = '';
    if (!item.magicDetected) item.cl = null;
  }
};
