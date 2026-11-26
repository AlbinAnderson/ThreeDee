import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { handoutActions, newId, type Handout, type User } from '@vtt/shared';
import { CheckboxField, ImageUploadButton, SelectField, TextAreaField, TextField } from '../components/fields';
import { uploadAsset } from '../lib/assets';
import { onEphemeral } from '../net/ephemeral';
import { dispatch } from '../state/dispatch';
import { useGameStore } from '../state/gameStore';
import { useGame, useIsGm } from '../state/hooks';
import { notify } from '../state/notifications';
import { sendEphemeral } from '../state/session';

/** Which handout is open in the viewer popup. */
export const useHandoutViewer = create<{ openId: string | null }>(() => ({ openId: null }));
const openHandout = (openId: string | null) => useHandoutViewer.setState({ openId });

export function HandoutsPanel() {
  const handouts = useGame((s) => s.handouts);
  const gm = useIsGm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const list = useMemo(() => Object.values(handouts).sort((a, b) => b.createdAt - a.createdAt), [handouts]);

  function create() {
    const id = newId();
    const ok = dispatch(
      handoutActions.create.create({
        handout: { id, title: 'New handout', imageUrl: null, text: '', share: 'gm', sharedWith: [], createdAt: Date.now() },
      }),
    );
    if (ok) setEditingId(id);
  }

  return (
    <div className="panel-scroll">
      {gm && (
        <div className="section-header">
          <h3>Handouts</h3>
          <button type="button" className="primary small" onClick={create}>
            + New
          </button>
        </div>
      )}
      {list.length === 0 && <p className="muted">{gm ? 'No handouts yet. Letters, maps, wanted posters…' : 'The GM hasn’t shared any handouts.'}</p>}
      <ul className="handout-list">
        {list.map((h) => (
          <li key={h.id}>
            <div className="handout-row">
              <button type="button" className="handout-open" onClick={() => openHandout(h.id)}>
                {h.imageUrl ? <img src={h.imageUrl} alt="" className="loot-thumb" /> : <span className="loot-thumb empty">✉</span>}
                <span className="handout-title">{h.title}</span>
              </button>
              {gm && <ShareBadge h={h} />}
              {gm && (
                <button type="button" className="small" onClick={() => setEditingId(editingId === h.id ? null : h.id)}>
                  {editingId === h.id ? 'Done' : 'Edit'}
                </button>
              )}
            </div>
            {gm && editingId === h.id && <HandoutEditor handout={h} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShareBadge({ h }: { h: Handout }) {
  const label = h.share === 'all' ? 'Everyone' : h.share === 'gm' ? 'GM only' : `${h.sharedWith.length} player${h.sharedWith.length === 1 ? '' : 's'}`;
  return <span className={`badge ${h.share === 'gm' ? 'subtle' : ''}`}>{label}</span>;
}

function HandoutEditor({ handout: h }: { handout: Handout }) {
  const users = useGame((s) => s.users);
  const players = useMemo(() => Object.values(users).filter((u) => u.role !== 'gm'), [users]);
  const update = (changes: Parameters<typeof handoutActions.update.create>[0]['changes']) =>
    dispatch(handoutActions.update.create({ id: h.id, changes }));

  function showToPlayers() {
    // Make sure it's visible first; the popup event follows the update over the same socket.
    if (h.share === 'gm') update({ share: 'all' });
    sendEphemeral({ kind: 'showHandout', handoutId: h.id });
    notify('Shown to players', 'info');
  }

  return (
    <div className="loot-editor">
      <TextField label="Title" value={h.title} onCommit={(title) => update({ title })} />
      <div className="button-row">
        {h.imageUrl && <img src={h.imageUrl} alt="" className="loot-image" />}
        <ImageUploadButton
          label={h.imageUrl ? 'Replace image' : 'Add image'}
          onFile={async (file) => {
            try {
              update({ imageUrl: await uploadAsset(file) });
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        />
        {h.imageUrl && (
          <button type="button" onClick={() => update({ imageUrl: null })}>
            Remove image
          </button>
        )}
      </div>
      <TextAreaField label="Text" value={h.text} rows={6} onCommit={(text) => update({ text })} />
      <SelectField
        label="Visible to"
        value={h.share}
        options={[
          { value: 'gm', label: 'Only me (GM)' },
          { value: 'all', label: 'Everyone' },
          { value: 'some', label: 'Chosen players' },
        ]}
        onCommit={(share) => update({ share })}
      />
      {h.share === 'some' && <PlayerPicker players={players} value={h.sharedWith} onChange={(sharedWith) => update({ sharedWith })} />}
      <div className="button-row">
        <button type="button" className="primary" onClick={showToPlayers}>
          Show to players
        </button>
        <button type="button" className="danger" onClick={() => confirm(`Delete "${h.title}"?`) && dispatch(handoutActions.remove.create({ id: h.id }))}>
          Delete
        </button>
      </div>
    </div>
  );
}

function PlayerPicker({ players, value, onChange }: { players: User[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!players.length) return <p className="muted small-text">No players have joined yet.</p>;
  return (
    <fieldset className="owners">
      <legend>Players</legend>
      {players.map((u) => (
        <CheckboxField
          key={u.id}
          label={u.name}
          value={value.includes(u.id)}
          onCommit={(on) => onChange(on ? [...value, u.id] : value.filter((id) => id !== u.id))}
        />
      ))}
    </fieldset>
  );
}

/** Popup viewer; mounted once in the table view. Opens itself when the GM shows a handout. */
export function HandoutViewer() {
  const openId = useHandoutViewer((s) => s.openId);
  const handout = useGame((s) => (openId ? s.handouts[openId] : undefined));

  useEffect(
    () =>
      onEphemeral('showHandout', (_from, e) => {
        if (useGameStore.getState().view?.handouts[e.handoutId]) openHandout(e.handoutId);
      }),
    [],
  );

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openHandout(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  if (!handout) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && openHandout(null)}>
      <div className="modal handout-modal">
        <div className="inspector-header">
          <strong>{handout.title}</strong>
          <button type="button" className="icon-button" onClick={() => openHandout(null)} title="Close (Esc)">
            ×
          </button>
        </div>
        {handout.imageUrl && <img src={handout.imageUrl} alt={handout.title} className="handout-image" />}
        {handout.text && <div className="handout-text">{handout.text}</div>}
      </div>
    </div>
  );
}
