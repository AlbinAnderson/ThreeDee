/**
 * Per-player notepad. Each player's notes are private to them and the GM:
 * they're redacted from other players' snapshots and updates are only
 * delivered to the owner and GMs.
 */
import { z } from 'zod';
import { defineAction, type Redactor } from '../actions/define';
import { allowAnyone, isGm } from '../actions/auth';
import { NOTE_MAX_LENGTH } from '../state';

/** The notepad text after appending `text` (blank-line separated). */
export function appendedNote(existing: string, text: string): string {
  return existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n${text}` : text;
}

export const notesActions = {
  /** Replace the author's own notes. */
  set: defineAction('notes/set', z.object({ text: z.string().max(NOTE_MAX_LENGTH) }), {
    authorize: allowAnyone,
    audience: (viewer, _payload, { meta }) => isGm(viewer) || viewer.id === meta.userId,
    apply(draft, { text }, meta) {
      draft.notes[meta.userId] = { text, updatedAt: meta.ts };
    },
  }),

  /** Append to the author's own notes (e.g. a character note copied over), refusing to overflow the notepad. */
  append: defineAction('notes/append', z.object({ text: z.string().trim().min(1).max(NOTE_MAX_LENGTH) }), {
    authorize(ctx, { text }) {
      const next = appendedNote(ctx.state.notes[ctx.user.id]?.text ?? '', text);
      return next.length <= NOTE_MAX_LENGTH || `Your notepad is full (max ${NOTE_MAX_LENGTH} characters)`;
    },
    audience: (viewer, _payload, { meta }) => isGm(viewer) || viewer.id === meta.userId,
    apply(draft, { text }, meta) {
      const next = appendedNote(draft.notes[meta.userId]?.text ?? '', text);
      if (next.length <= NOTE_MAX_LENGTH) draft.notes[meta.userId] = { text: next, updatedAt: meta.ts };
    },
  }),
};

export const redactNotes: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const userId of Object.keys(draft.notes)) {
    if (userId !== viewer.id) delete draft.notes[userId];
  }
};
