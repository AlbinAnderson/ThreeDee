import { z } from 'zod';
import { defineAction } from '../actions/define';
import { allowAnyone, requireGm } from '../actions/auth';
import { CHAT_HISTORY_LIMIT, IdSchema, type ChatMessage } from '../state';
import { DiceError, parseDice, rollDice, RollResultSchema } from '../dice';
import type { Draft } from 'immer';

function pushMessage(chat: Draft<ChatMessage[]>, msg: ChatMessage) {
  chat.push(msg);
  if (chat.length > CHAT_HISTORY_LIMIT) chat.splice(0, chat.length - CHAT_HISTORY_LIMIT);
}

export const chatActions = {
  send: defineAction('chat/send', z.object({ id: IdSchema, text: z.string().trim().min(1).max(2000) }), {
    authorize: allowAnyone,
    apply(draft, { id, text }, meta) {
      pushMessage(draft.chat, { id, userId: meta.userId, ts: meta.ts, text });
    },
  }),

  roll: defineAction(
    'chat/roll',
    z.object({
      id: IdSchema,
      expression: z.string().trim().min(1).max(200),
      label: z.string().trim().max(100).optional(),
      /** Filled in by the server in `prepare`; anything a client sends is overwritten. */
      result: RollResultSchema.optional(),
    }),
    {
      optimistic: false,
      authorize(_ctx, { expression }) {
        try {
          parseDice(expression);
          return true;
        } catch (e) {
          return e instanceof DiceError ? e.message : 'Invalid roll';
        }
      },
      prepare(ctx, payload) {
        return { ...payload, result: rollDice(payload.expression, ctx.random) };
      },
      apply(draft, { id, label, result }, meta) {
        if (!result) return;
        pushMessage(draft.chat, { id, userId: meta.userId, ts: meta.ts, text: label ?? '', roll: result });
      },
    },
  ),

  clear: defineAction('chat/clear', z.object({}), {
    authorize: requireGm,
    apply(draft) {
      draft.chat = [];
    },
  }),
};
