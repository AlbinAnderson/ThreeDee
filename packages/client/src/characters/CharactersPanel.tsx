import { useMemo, useRef, useState, type DragEvent } from 'react';
import {
  canControlToken,
  canManageCharacter,
  characterActions,
  classSummary,
  isGm,
  type Character,
} from '@vtt/shared';
import { CheckboxField, TextField } from '../components/fields';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { CharacterSummary } from './CharacterSummary';
import { openImport } from './ImportDialog';
import { useCharactersUi } from './store';

/** Characters you can see, yours first. */
export function useVisibleCharacters(): Character[] {
  const characters = useGame((s) => s.characters);
  const self = useSelf();
  return useMemo(
    () =>
      Object.values(characters).sort(
        (a, b) => Number(b.ownerId === self.id) - Number(a.ownerId === self.id) || a.name.localeCompare(b.name),
      ),
    [characters, self.id],
  );
}

function PcgFileButton({ label, targetId, className }: { label: string; targetId?: string; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept=".pcg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openImport(file, targetId);
        }}
      />
    </>
  );
}

export function CharactersPanel() {
  const list = useVisibleCharacters();
  const users = useGame((s) => s.users);
  const tokens = useGame((s) => s.tokens);
  const selectedId = useCharactersUi((s) => s.selectedId);
  const selected = list.find((c) => c.id === selectedId) ?? null;
  const [dragging, setDragging] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = [...e.dataTransfer.files].find((f) => /\.pcg$/i.test(f.name)) ?? e.dataTransfer.files[0];
    if (file) void openImport(file);
  }

  return (
    <div
      className={`panel-scroll characters-panel${dragging ? ' drop-target' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {selected ? (
        <CharacterView character={selected} onBack={() => useCharactersUi.setState({ selectedId: null })} />
      ) : (
        <>
          <section>
            <div className="section-header">
              <h3>Characters</h3>
              <PcgFileButton label="Import .pcg" className="small primary" />
            </div>
            <div className="drop-hint">Drop a PCGen .pcg file here, or use Import.</div>
            {list.length === 0 && <p className="muted">No characters yet.</p>}
            <ul className="character-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => useCharactersUi.setState({ selectedId: c.id })}>
                    <span className="character-name">{c.name}</span>
                    <span className="muted small-text">{classSummary(c.build)}</span>
                    <span className="character-meta small-text">
                      {c.ownerId ? (users[c.ownerId]?.name ?? 'Unknown player') : 'GM (NPC)'}
                      {c.tokenId && tokens[c.tokenId] && ` · 🔗 ${tokens[c.tokenId]!.name || 'token'}`}
                      {c.shared && ' · shared'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <p className="muted small-text">
            Characters are private to their player and the GM unless shared with the party. In PCGen, use File → Save to get the .pcg
            file.
          </p>
        </>
      )}
    </div>
  );
}

function CharacterView({ character: c, onBack }: { character: Character; onBack: () => void }) {
  const self = useSelf();
  const gm = isGm(self);
  const users = useGame((s) => s.users);
  const tokens = useGame((s) => s.tokens);
  const scenes = useGame((s) => s.scenes);
  const manage = canManageCharacter(self, c);
  const players = useMemo(() => Object.values(users).filter((u) => u.role !== 'gm'), [users]);
  const linkable = useMemo(
    () =>
      Object.values(tokens)
        .filter((t) => canControlToken(self, t) || t.id === c.tokenId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tokens, self, c.tokenId],
  );
  const linked = c.tokenId ? tokens[c.tokenId] : undefined;

  return (
    <section>
      <button type="button" className="link-button" onClick={onBack}>
        ← All characters
      </button>
      <h2 className="character-title">{c.name}</h2>
      {manage ? (
        <>
          <TextField label="Name in the VTT" value={c.name} onCommit={(name) => name.trim() && dispatch(characterActions.update.create({ id: c.id, changes: { name } }))} />
          <div className="field">
            <label>Played by</label>
            {gm ? (
              <select value={c.ownerId ?? ''} onChange={(e) => dispatch(characterActions.setOwner.create({ id: c.id, ownerId: e.target.value || null }))}>
                <option value="">GM (NPC)</option>
                {players.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : (
              <span>{c.ownerId ? users[c.ownerId]?.name : 'GM (NPC)'}</span>
            )}
          </div>
          <div className="field">
            <label>Token on the map</label>
            <select value={c.tokenId ?? ''} onChange={(e) => dispatch(characterActions.linkToken.create({ id: c.id, tokenId: e.target.value || null }))}>
              <option value="">Not linked</option>
              {linkable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || '(unnamed)'} · {scenes[t.sceneId]?.name ?? '?'}
                </option>
              ))}
            </select>
          </div>
          {linked && (
            <button type="button" className="small" onClick={() => useUi.getState().setSelection([linked.id])}>
              Select token on map
            </button>
          )}
          <CheckboxField
            label="Share with the party"
            value={c.shared}
            onCommit={(shared) => dispatch(characterActions.update.create({ id: c.id, changes: { shared } }))}
          />
          <div className="button-row">
            <PcgFileButton label="Re-import .pcg…" targetId={c.id} className="small" />
            <button
              type="button"
              className="small danger"
              onClick={() => confirm(`Delete ${c.name}? Its token stays on the map.`) && dispatch(characterActions.remove.create({ id: c.id }))}
            >
              Delete
            </button>
          </div>
        </>
      ) : (
        <p className="muted small-text">Played by {c.ownerId ? users[c.ownerId]?.name : 'the GM'} · shared with the party</p>
      )}
      <p className="muted small-text">
        From {c.source.fileName}, imported {new Date(c.source.importedAt).toLocaleString()}.
      </p>
      <CharacterSummary build={c.build} />
    </section>
  );
}
