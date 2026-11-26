/**
 * Rollable tables. Weighted entries, rolled on the server, result posted to
 * chat. Tables are GM-only unless "players can roll" is on (so random
 * encounter tables stay secret).
 */
import { z } from 'zod';
import { defineAction, type Redactor } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import { ChatWhisperSchema, IdSchema, RollTableSchema, type RollTable, type User } from '../state';
import { chatAudience, pushMessage, validateWhisper } from './chat';

const canSeeTable = (user: User, t: RollTable) => isGm(user) || t.playersCanRoll;
const TableChangesSchema = RollTableSchema.pick({ name: true, entries: true, playersCanRoll: true }).partial();

export const tableActions = {
  create: defineAction('table/create', z.object({ table: RollTableSchema }), {
    authorize: requireGm,
    audience: (viewer, { table }) => canSeeTable(viewer, table),
    apply(draft, { table }) {
      if (!draft.tables[table.id]) draft.tables[table.id] = table;
    },
  }),

  update: defineAction('table/update', z.object({ id: IdSchema, changes: TableChangesSchema, full: RollTableSchema.optional() }), {
    authorize: (ctx, { id }) => (requireGm(ctx) === true ? !!ctx.state.tables[id] || 'Table not found' : requireGm(ctx)),
    prepare: (ctx, { id, changes }) => ({ id, changes, full: { ...ctx.state.tables[id]!, ...changes } }),
    audience: (viewer, { id, full }, { state }) =>
      (!!state.tables[id] && canSeeTable(viewer, state.tables[id]!)) || (!!full && canSeeTable(viewer, full)),
    apply(draft, { id, changes, full }) {
      if (full) draft.tables[id] = full;
      else if (draft.tables[id]) Object.assign(draft.tables[id]!, changes);
    },
  }),

  remove: defineAction('table/delete', z.object({ id: IdSchema }), {
    authorize: requireGm,
    apply(draft, { id }) {
      delete draft.tables[id];
    },
  }),

  roll: defineAction(
    'table/roll',
    z.object({
      tableId: IdSchema,
      chatId: IdSchema,
      whisper: ChatWhisperSchema.optional(),
      /** Filled in by the server. */
      result: z.object({ entryId: IdSchema, text: z.string(), tableName: z.string(), roll: z.number(), total: z.number() }).optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { tableId, whisper }) {
        const t = ctx.state.tables[tableId];
        if (!t) return 'Table not found';
        if (!canSeeTable(ctx.user, t)) return 'Only the GM can roll on that table';
        if (!t.entries.length) return 'That table has no entries';
        return validateWhisper(ctx, whisper);
      },
      prepare(ctx, payload) {
        const t = ctx.state.tables[payload.tableId]!;
        const total = t.entries.reduce((s, e) => s + e.weight, 0);
        const roll = ctx.random(total) + 1;
        let acc = 0;
        const entry = t.entries.find((e) => (acc += e.weight) >= roll)!;
        return { ...payload, result: { entryId: entry.id, text: entry.text, tableName: t.name, roll, total } };
      },
      audience: chatAudience,
      apply(draft, { chatId, whisper, result }, meta) {
        if (!result) return;
        pushMessage(draft.chat, {
          id: chatId,
          userId: meta.userId,
          ts: meta.ts,
          text: '',
          card: { title: result.text, subtitle: `${result.tableName} · rolled ${result.roll} of ${result.total}` },
          ...(whisper ? { whisper } : {}),
        });
      },
    },
  ),
};

export const redactTables: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const t of Object.values(draft.tables)) if (!canSeeTable(viewer, t)) delete draft.tables[t.id];
};
