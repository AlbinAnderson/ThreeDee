/**
 * Per-player notepad. Each player's notes are private to them and the GM:
 * they're redacted from other players' snapshots and updates are only
 * delivered to the owner and GMs.
 */
import { z } from 'zod';
import { defineAction, type Redactor } from '../actions/define';
import { allowAnyone, isGm } from '../actions/auth';
import { NOTE_MAX_LENGTH } from '../state';

export const notesActions = {
  /** Replace the author's own notes. */
  set: defineAction('notes/set', z.object({ text: z.string().max(NOTE_MAX_LENGTH) }), {
    authorize: allowAnyone,
    audience: (viewer, _payload, { meta }) => isGm(viewer) || viewer.id === meta.userId,
    apply(draft, { text }, meta) {
      draft.notes[meta.userId] = { text, updatedAt: meta.ts };
    },
  }),
};

export const redactNotes: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const userId of Object.keys(draft.notes)) {
    if (userId !== viewer.id) delete draft.notes[userId];
  }
};
