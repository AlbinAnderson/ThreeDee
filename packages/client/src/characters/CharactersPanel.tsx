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
import { syncLinkedToken } from './characterActions';
import { CharacterSettings } from './CharacterSettings';
import { CharacterSheet } from './CharacterSheet';
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
    // Always a new import: re-importing over a character is an explicit choice (its Re-import button),
    // so dropping a different character's file while one is open can't offer to overwrite it.
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
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
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

type CharacterTab = 'sheet' | 'imported' | 'settings' | 'manage';

function CharacterView({ character: c, onBack }: { character: Character; onBack: () => void }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const [tab, setTab] = useState<CharacterTab>('sheet');
  const activeTab: CharacterTab = !manage && (tab === 'settings' || tab === 'manage') ? 'sheet' : tab;
  const tabs: [CharacterTab, string][] = [
    ['sheet', 'Sheet'],
    ['imported', 'Imported'],
    ...(manage ? ([['settings', 'Settings'], ['manage', 'Manage']] as [CharacterTab, string][]) : []),
  ];

  return (
    <section>
      <button type="button" className="link-button" onClick={onBack}>
        ← All characters
      </button>
      <h2 className="character-title">{c.name}</h2>
      <div className="segmented sheet-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className={activeTab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'sheet' && <CharacterSheet character={c} onOpenSettings={() => setTab('settings')} />}
      {activeTab === 'imported' && <CharacterSummary build={c.build} />}
      {activeTab === 'settings' && manage && <CharacterSettings character={c} />}
      {activeTab === 'manage' && manage && <ManageCharacter character={c} onBack={onBack} />}
    </section>
  );
}

function ManageCharacter({ character: c, onBack }: { character: Character; onBack: () => void }) {
  const self = useSelf();
  const gm = isGm(self);
  const users = useGame((s) => s.users);
  const tokens = useGame((s) => s.tokens);
  const scenes = useGame((s) => s.scenes);
  const activeSceneId = useGame((s) => s.activeSceneId);
  const viewedSceneId = useUi((s) => s.viewedSceneId);
  const players = useMemo(() => Object.values(users).filter((u) => u.role !== 'gm'), [users]);
  const ownerUser = c.ownerId ? users[c.ownerId] : undefined;
  const linkable = useMemo(
    () =>
      Object.values(tokens)
        .filter((t) => canControlToken(self, t) || t.id === c.tokenId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tokens, self, c.tokenId],
  );
  const linked = c.tokenId ? tokens[c.tokenId] : undefined;
  const currentSceneId = gm ? (viewedSceneId ?? activeSceneId) : activeSceneId;
  const linkedOnOtherScene = !!linked && linked.sceneId !== currentSceneId;

  function selectLinkedToken() {
    if (!linked) return;
    if (linked.sceneId !== currentSceneId) {
      if (!gm) return;
      useUi.getState().setViewedScene(linked.sceneId);
    }
    useUi.getState().setSelection([linked.id]);
  }

  return (
    <div>
      <TextField
        label="Name in the VTT"
        value={c.name}
        onCommit={(name) => {
          if (name.trim() && dispatch(characterActions.update.create({ id: c.id, changes: { name } }))) syncLinkedToken({ ...c, name });
        }}
      />
      <div className="field">
        <label>Played by</label>
        {gm ? (
          <select value={c.ownerId ?? ''} onChange={(e) => dispatch(characterActions.setOwner.create({ id: c.id, ownerId: e.target.value || null }))}>
            <option value="">GM (NPC)</option>
            {ownerUser && ownerUser.role === 'gm' && <option value={ownerUser.id}>{ownerUser.name} (GM)</option>}
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
      <p className="muted small-text">
        Linking copies max HP, name, size, darkvision and the initiative modifier to the token. While linked, the token holds the live HP.
      </p>
      {linked && (
        <div className="button-row">
          <button
            type="button"
            className="small"
            disabled={!gm && linkedOnOtherScene}
            title={!gm && linkedOnOtherScene ? `Token is on ${scenes[linked.sceneId]?.name ?? 'another scene'}` : undefined}
            onClick={selectLinkedToken}
          >
            {gm && linkedOnOtherScene ? `Jump to token (${scenes[linked.sceneId]?.name ?? 'other scene'})` : 'Select token on map'}
          </button>
          <button type="button" className="small" onClick={() => syncLinkedToken(c)}>
            ↻ Sync token now
          </button>
        </div>
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
          onClick={() => {
            if (confirm(`Delete ${c.name}? Its token stays on the map.`) && dispatch(characterActions.remove.create({ id: c.id }))) onBack();
          }}
        >
          Delete
        </button>
      </div>
      <p className="muted small-text">
        From {c.source.fileName}, imported {new Date(c.source.importedAt).toLocaleString()}.
      </p>
    </div>
  );
}
