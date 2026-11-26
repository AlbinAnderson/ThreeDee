import { useEffect, useRef, useState } from 'react';
import { NOTE_MAX_LENGTH, notesActions } from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { useGame } from '../state/hooks';
import type { PlayerSectionProps } from './types';

const AUTOSAVE_MS = 1000;

/** A player's private notepad. Editable by its owner, readable by the GM. */
export function NotesSection({ player, isSelf }: PlayerSectionProps) {
  const note = useGame((s) => s.notes[player.id]);
  const saved = note?.text ?? '';
  const [draft, setDraft] = useState(saved);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  // Adopt remote changes (e.g. edits from another tab) when not typing.
  useEffect(() => {
    if (!focused.current) setDraft(saved);
  }, [saved]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (latest.current !== saved) dispatch(notesActions.set.create({ text: latest.current }));
  };

  // Save pending edits if the section unmounts (tab switch).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  if (!isSelf) {
    return saved ? <div className="notes-readonly">{saved}</div> : <p className="muted">No notes yet.</p>;
  }

  const dirty = draft !== saved;
  return (
    <div className="notes">
      <textarea
        className="notes-text"
        value={draft}
        maxLength={NOTE_MAX_LENGTH}
        placeholder="Names, clues, quest hooks, who owes who money…"
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          flush();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, AUTOSAVE_MS);
        }}
      />
      <div className="notes-status muted small-text">
        {dirty ? 'Saving…' : note ? `Saved ${new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        <span>Visible to you and the GM</span>
      </div>
    </div>
  );
}
