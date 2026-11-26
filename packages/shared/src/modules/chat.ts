/**
 * Chat and dice. Messages can be public, GM-only (author + GMs) or whispered
 * (author + recipients); restricted messages are only delivered to, and kept
 * in the state of, the people who may read them.
 */
import { z } from 'zod';
import type { Draft } from 'immer';
import { defineAction, type AuthContext, type AuthResult, type Redactor } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import { CHAT_HISTORY_LIMIT, ChatCardSchema, ChatWhisperSchema, IdSchema, type ChatMessage, type ChatWhisper, type User } from '../state';
import { DiceError, parseDice, rollDice, RollResultSchema } from '../dice';

export function pushMessage(chat: Draft<ChatMessage[]>, msg: ChatMessage) {
  chat.push(msg);
  if (chat.length > CHAT_HISTORY_LIMIT) chat.splice(0, chat.length - CHAT_HISTORY_LIMIT);
}

/** Whether `viewer` may read a message by `authorId` with the given visibility. */
export function canSeeMessage(viewer: User, authorId: string, whisper: ChatWhisper | undefined): boolean {
  if (!whisper || viewer.id === authorId) return true;
  if (whisper.mode === 'gm') return isGm(viewer);
  return whisper.to.includes(viewer.id);
}

/** Audience helper for any action that posts a chat message with an optional `whisper`. */
export const chatAudience = (viewer: User, payload: { whisper?: ChatWhisper }, ctx: { meta: { userId: string } }) =>
  canSeeMessage(viewer, ctx.meta.userId, payload.whisper);

export function validateWhisper(ctx: AuthContext, whisper: ChatWhisper | undefined): AuthResult {
  if (!whisper) return true;
  if (whisper.mode === 'whisper') {
    if (whisper.to.length === 0) return 'Choose who to whisper to';
    if (whisper.to.some((id) => !ctx.state.users[id])) return 'Unknown whisper recipient';
  }
  return true;
}

export const chatActions = {
  send: defineAction(
    'chat/send',
    z.object({ id: IdSchema, text: z.string().trim().min(1).max(2000), whisper: ChatWhisperSchema.optional() }),
    {
      authorize: (ctx, { whisper }) => validateWhisper(ctx, whisper),
      audience: chatAudience,
      apply(draft, { id, text, whisper }, meta) {
        pushMessage(draft.chat, { id, userId: meta.userId, ts: meta.ts, text, ...(whisper ? { whisper } : {}) });
      },
    },
  ),

  roll: defineAction(
    'chat/roll',
    z.object({
      id: IdSchema,
      expression: z.string().trim().min(1).max(200),
      label: z.string().trim().max(100).optional(),
      whisper: ChatWhisperSchema.optional(),
      /** Filled in by the server in `prepare`; anything a client sends is overwritten. */
      result: RollResultSchema.optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { expression, whisper }) {
        try {
          parseDice(expression);
        } catch (e) {
          return e instanceof DiceError ? e.message : 'Invalid roll';
        }
        return validateWhisper(ctx, whisper);
      },
      prepare(ctx, payload) {
        return { ...payload, result: rollDice(payload.expression, ctx.random) };
      },
      audience: chatAudience,
      apply(draft, { id, label, result, whisper }, meta) {
        if (!result) return;
        pushMessage(draft.chat, {
          id,
          userId: meta.userId,
          ts: meta.ts,
          text: label ?? '',
          roll: result,
          ...(whisper ? { whisper } : {}),
        });
      },
    },
  ),

  /** A card (an ability, an item...) posted to chat; follows the chat mode like any message. */
  card: defineAction('chat/card', z.object({ id: IdSchema, card: ChatCardSchema, whisper: ChatWhisperSchema.optional() }), {
    authorize: (ctx, { whisper }) => validateWhisper(ctx, whisper),
    audience: chatAudience,
    apply(draft, { id, card, whisper }, meta) {
      pushMessage(draft.chat, { id, userId: meta.userId, ts: meta.ts, text: '', card, ...(whisper ? { whisper } : {}) });
    },
  }),

  clear: defineAction('chat/clear', z.object({}), {
    authorize: requireGm,
    apply(draft) {
      draft.chat = [];
    },
  }),
};

export const redactChat: Redactor = (draft, viewer) => {
  if (draft.chat.some((m) => !canSeeMessage(viewer, m.userId, m.whisper))) {
    draft.chat = draft.chat.filter((m) => canSeeMessage(viewer, m.userId, m.whisper));
  }
};
