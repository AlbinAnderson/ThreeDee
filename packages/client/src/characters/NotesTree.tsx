/** The character's hierarchical notes (from the .pcg NOTE tree or added here), with copy-to-Notepad. */
import { useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardCopy, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  buildNoteTree,
  characterBioActions,
  formatNotesText,
  MAX_CHARACTER_NOTES,
  newId,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  noteDescendants,
  notesActions,
  type Character,
  type NoteNode,
} from '@vtt/shared';
import { confirmDialog, promptDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { notify } from '../state/notifications';

async function addNote(c: Character, parentId: string | null) {
  if (c.bio.notes.length >= MAX_CHARACTER_NOTES) return notify(`At most ${MAX_CHARACTER_NOTES} notes`);
  const title = (await promptDialog({ title: parentId ? 'Add sub-note' : 'Add note', label: 'Title', maxLength: NOTE_TITLE_MAX, confirmLabel: 'Add' }))?.trim();
  if (!title) return;
  dispatch(characterBioActions.addNote.create({ id: c.id, note: { id: newId(), parentId, title, body: '' } }));
}

function copyToNotepad(c: Character, rootId?: string) {
  const text = formatNotesText(c.bio.notes, rootId, `— ${c.name} —`);
  if (!text.trim()) return notify('Nothing to copy');
  if (dispatch(notesActions.append.create({ text }))) notify('Copied to your Notepad', 'info');
}

export function NotesTree({ character: c, manage }: { character: Character; manage: boolean }) {
  const tree = buildNoteTree(c.bio.notes);
  return (
    <section className="bio-section">
      <div className="section-header">
        <h3>Notes</h3>
        <div className="button-row">
          {c.bio.notes.length > 0 && (
            <button type="button" className="small" title="Append all notes to your private Notepad" onClick={() => copyToNotepad(c)}>
              <ClipboardCopy size={12} /> Copy all
            </button>
          )}
          {manage && (
            <button type="button" className="small gold" onClick={() => void addNote(c, null)}>
              <Plus size={12} /> Note
            </button>
          )}
        </div>
      </div>
      {tree.length === 0 ? (
        <p className="muted small-text">No notes yet.{manage ? ' Notes from the .pcg Notes tab appear here.' : ''}</p>
      ) : (
        <ul className="note-tree">
          {tree.map((n) => (
            <NoteItem key={n.note.id} node={n} character={c} manage={manage} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteItem({ node, character: c, manage }: { node: NoteNode; character: Character; manage: boolean }) {
  const { note } = node;
  const [open, setOpen] = useState(node.depth < 1);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const hasKids = node.children.length > 0;

  function startEdit() {
    setTitle(note.title);
    setBody(note.body);
    setEditing(true);
    setOpen(true);
  }

  function save() {
    const t = title.trim().slice(0, NOTE_TITLE_MAX);
    if (!t) return notify('A note needs a title');
    const changes: { title?: string; body?: string } = {};
    if (t !== note.title) changes.title = t;
    if (body !== note.body) changes.body = body.slice(0, NOTE_BODY_MAX);
    if (Object.keys(changes).length === 0 || dispatch(characterBioActions.updateNote.create({ id: c.id, noteId: note.id, changes }))) setEditing(false);
  }

  async function remove() {
    const n = noteDescendants(c.bio.notes, note.id).size;
    const ok = await confirmDialog({
      title: `Delete “${note.title}”?`,
      message: n > 0 ? `This also deletes its ${n} sub-note${n === 1 ? '' : 's'}.` : 'This note will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) dispatch(characterBioActions.deleteNote.create({ id: c.id, noteId: note.id }));
  }

  return (
    <li>
      <div className="note-row">
        <button type="button" className="icon-button note-toggle" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen((v) => !v)} disabled={!hasKids && !note.body}>
          {hasKids || note.body ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span style={{ width: 13 }} />}
        </button>
        <button type="button" className="note-title" onClick={() => setOpen((v) => !v)} title={note.title}>
          {note.title}
          {hasKids && <span className="muted small-text"> ({node.children.length})</span>}
        </button>
        <button type="button" className="icon-button" title="Copy to your Notepad" aria-label="Copy to Notepad" onClick={() => copyToNotepad(c, note.id)}>
          <ClipboardCopy size={12} />
        </button>
        {manage && (
          <>
            <button type="button" className="icon-button" title="Add sub-note" aria-label="Add sub-note" onClick={() => void addNote(c, note.id)}>
              <Plus size={12} />
            </button>
            <button type="button" className="icon-button" title="Edit" aria-label="Edit note" onClick={startEdit}>
              <Pencil size={12} />
            </button>
            <button type="button" className="icon-button danger" title="Delete" aria-label="Delete note" onClick={() => void remove()}>
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
      {editing ? (
        <div className="note-edit">
          <input value={title} maxLength={NOTE_TITLE_MAX} aria-label="Note title" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <textarea value={body} rows={5} maxLength={NOTE_BODY_MAX} aria-label="Note text" onChange={(e) => setBody(e.target.value)} />
          <div className="button-row">
            <button type="button" className="small" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="small primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      ) : (
        open && note.body && <div className="note-body">{note.body}</div>
      )}
      {open && hasKids && (
        <ul className="note-tree nested">
          {node.children.map((k) => (
            <NoteItem key={k.note.id} node={k} character={c} manage={manage} />
          ))}
        </ul>
      )}
    </li>
  );
}
