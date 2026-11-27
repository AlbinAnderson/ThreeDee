/**
 * Character biography, portrait, notes tree and chronicle (Epic 10).
 *
 * Bio, notes and chronicle are as private as the character itself: changes go
 * to everyone who can see the character. GM notes (`bio.dmNotes`) are GM-only:
 * only a GM may write them, the action only reaches GMs, and every other
 * payload or snapshot has them blanked (see characters.ts).
 */
import { z } from 'zod';
import { defineAction } from '../../actions/define';
import { isGm } from '../../actions/auth';
import { noteDescendants } from '../../pf1e/bio';
import {
  BIO_TEXT_MAX,
  BioFieldsSchema,
  CharacterNoteSchema,
  ChronicleEntrySchema,
  MAX_CHARACTER_NOTES,
  MAX_CHRONICLES,
} from '../../entities/pf1e';
import type { GameState } from '../../state';
import { AssetUrlSchema, IdSchema } from '../../primitives';
import { beforeOrAfter, requireManage } from './characters';

const BioChangesSchema = z
  .object({
    fields: BioFieldsSchema.partial(),
    description: z.string().max(BIO_TEXT_MAX),
    biography: z.string().max(BIO_TEXT_MAX),
    portraitUrl: AssetUrlSchema.nullable(),
  })
  .partial();

const NoteChangesSchema = CharacterNoteSchema.pick({ title: true, body: true, parentId: true }).partial();
const ChronicleChangesSchema = ChronicleEntrySchema.omit({ id: true }).partial();

const seeIt = (viewer: Parameters<typeof beforeOrAfter>[0], id: string, state: GameState) => beforeOrAfter(viewer, id, undefined, state);

/** Whether `noteId` may move under `parentId` (exists, and isn't the note or one of its descendants). */
function canReparent(notes: { id: string; parentId: string | null }[], noteId: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  if (parentId === noteId || !notes.some((n) => n.id === parentId)) return false;
  return !noteDescendants(notes, noteId).has(parentId);
}

export const characterBioActions = {
  /** Bio text, appearance fields and portrait. */
  updateBio: defineAction('character/updateBio', z.object({ id: IdSchema, changes: BioChangesSchema }), {
    authorize: (ctx, { id }) => requireManage(ctx, id),
    audience: (viewer, { id }, { state }) => seeIt(viewer, id, state),
    apply(draft, { id, changes }, meta) {
      const c = draft.characters[id];
      if (!c) return;
      const { fields, ...rest } = changes;
      if (fields) Object.assign(c.bio.fields, fields);
      Object.assign(c.bio, rest);
      c.updatedAt = meta.ts;
    },
  }),

  /** GM only. Only GMs receive it; it touches nothing but the GM-only notes (so no updatedAt). */
  setDmNotes: defineAction('character/setDmNotes', z.object({ id: IdSchema, text: z.string().max(BIO_TEXT_MAX) }), {
    authorize(ctx, { id }) {
      if (!isGm(ctx.user)) return 'Only the GM can see or edit GM notes';
      return !!ctx.state.characters[id] || 'Character not found';
    },
    audience: (viewer) => isGm(viewer),
    apply(draft, { id, text }) {
      const c = draft.characters[id];
      if (c) c.bio.dmNotes = text;
    },
  }),

  addNote: defineAction('character/addNote', z.object({ id: IdSchema, note: CharacterNoteSchema }), {
    authorize(ctx, { id, note }) {
      const ok = requireManage(ctx, id);
      if (ok !== true) return ok;
      const notes = ctx.state.characters[id]!.bio.notes;
      if (notes.length >= MAX_CHARACTER_NOTES) return `At most ${MAX_CHARACTER_NOTES} notes`;
      if (notes.some((n) => n.id === note.id)) return 'Note already exists';
      if (note.parentId !== null && !notes.some((n) => n.id === note.parentId)) return 'Parent note not found';
      return true;
    },
    audience: (viewer, { id }, { state }) => seeIt(viewer, id, state),
    apply(draft, { id, note }, meta) {
      const c = draft.characters[id];
      if (!c) return;
      const notes = c.bio.notes;
      if (notes.length >= MAX_CHARACTER_NOTES || notes.some((n) => n.id === note.id)) return;
      if (note.parentId !== null && !notes.some((n) => n.id === note.parentId)) return;
      notes.push(note);
      c.updatedAt = meta.ts;
    },
  }),

  /** Edit a note's title/body, or move it under another note (never under itself or its own sub-notes). */
  updateNote: defineAction('character/updateNote', z.object({ id: IdSchema, noteId: IdSchema, changes: NoteChangesSchema }), {
    authorize(ctx, { id, noteId, changes }) {
      const ok = requireManage(ctx, id);
      if (ok !== true) return ok;
      const notes = ctx.state.characters[id]!.bio.notes;
      if (!notes.some((n) => n.id === noteId)) return 'Note not found';
      if (changes.parentId !== undefined && !canReparent(notes, noteId, changes.parentId)) return 'A note can’t be moved under itself';
      return true;
    },
    audience: (viewer, { id }, { state }) => seeIt(viewer, id, state),
    apply(draft, { id, noteId, changes }, meta) {
      const c = draft.characters[id];
      const note = c?.bio.notes.find((n) => n.id === noteId);
      if (!c || !note) return;
      if (changes.parentId !== undefined && !canReparent(c.bio.notes, noteId, changes.parentId)) return;
      Object.assign(note, changes);
      c.updatedAt = meta.ts;
    },
  }),

  /** Delete a note together with all its sub-notes. */
  deleteNote: defineAction('character/deleteNote', z.object({ id: IdSchema, noteId: IdSchema }), {
    authorize(ctx, { id, noteId }) {
      const ok = requireManage(ctx, id);
      if (ok !== true) return ok;
      return ctx.state.characters[id]!.bio.notes.some((n) => n.id === noteId) || 'Note not found';
    },
    audience: (viewer, { id }, { state }) => seeIt(viewer, id, state),
    apply(draft, { id, noteId }, meta) {
      const c = draft.characters[id];
      if (!c) return;
      const gone = noteDescendants(c.bio.notes, noteId);
      gone.add(noteId);
      c.bio.notes = c.bio.notes.filter((n) => !gone.has(n.id));
      c.updatedAt = meta.ts;
    },
  }),

  addChronicle: defineAction('character/addChronicle', z.object({ id: IdSchema, entry: ChronicleEntrySchema }), {
    authorize(ctx, { id, entry }) {
      const ok = requireManage(ctx, id);
      if (ok !== true) return ok;
      const list = ctx.state.characters[id]!.bio.chronicles;
      if (list.length >= MAX_CHRONICLES) return `At most ${MAX_CHRONICLES} chronicle entries`;
      return !list.some((e) => e.id === entry.id) || 'Chronicle entry already exists';
    },
    audience: (viewer, { id }, { state }) => seeIt(viewer, id, state),
    apply(draft, { id, entry }, meta) {
      const c = draft.characters[id];
      if (!c || c.bio.chronicles.length >= MAX_CHRONICLES || c.bio.chronicles.some((e) => e.id === entry.id)) return;
      c.bio.chronicles.push(entry);
      c.updatedAt = meta.ts;
    },
  }),

  updateChronicle: defineAction('character/updateChronicle', z.object({ id: IdSchema, entryId: IdSchema, changes: ChronicleChangesSchema }), {
    authorize(ctx, { id, entryId }) {
      const ok = requireManage(ctx, id);
      if (ok !== true) return ok;
      return ctx.state.characters[id]!.bio.chronicles.some((e) => e.id === entryId) || 'Chronicle entry not found';
    },
    audience: (viewer, { id }, { state }) => seeIt(viewer, id, state),
    apply(draft, { id, entryId, changes }, meta) {
      const c = draft.characters[id];
      const entry = c?.bio.chronicles.find((e) => e.id === entryId);
      if (!c || !entry) return;
      Object.assign(entry, changes);
      c.updatedAt = meta.ts;
    },
  }),

  deleteChronicle: defineAction('character/deleteChronicle', z.object({ id: IdSchema, entryId: IdSchema }), {
    authorize(ctx, { id, entryId }) {
      const ok = requireManage(ctx, id);
      if (ok !== true) return ok;
      return ctx.state.characters[id]!.bio.chronicles.some((e) => e.id === entryId) || 'Chronicle entry not found';
    },
    audience: (viewer, { id }, { state }) => seeIt(viewer, id, state),
    apply(draft, { id, entryId }, meta) {
      const c = draft.characters[id];
      if (!c) return;
      c.bio.chronicles = c.bio.chronicles.filter((e) => e.id !== entryId);
      c.updatedAt = meta.ts;
    },
  }),
};
