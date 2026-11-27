import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, Link2, Maximize2, Minimize2, MoreVertical, Upload, X } from 'lucide-react';
import {
  canControlToken,
  canManageCharacter,
  characterActions,
  classSummary,
  isGm,
  tokenActions,
  type Character,
} from '@vtt/shared';
import { CheckboxField, TextField } from '../components/fields';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { syncLinkedToken } from './characterActions';
import { CharacterSettings } from './CharacterSettings';
import { CharacterSheet } from './CharacterSheet';
import { CharacterSummary } from './CharacterSummary';
import { AbilitiesTab } from './AbilitiesTab';
import { InventoryTab } from './InventoryTab';
import { SkillsTab } from './SkillsTab';
import { SpellsTab } from './SpellsTab';
import { EffectsTab } from './EffectsTab';
import { openImport } from './ImportDialog';
import { useCharactersUi, type CharacterTab } from './store';

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
        <Upload size={13} />
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
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {selected ? (
        <CharacterView character={selected} onBack={() => useCharactersUi.setState({ selectedId: null, poppedOut: false })} />
      ) : (
        <>
          <section>
            <div className="section-header">
              <h3>Characters</h3>
              <PcgFileButton label="Import .pcg" className="small gold" />
            </div>
            <div className="drop-hint">Drop a PCGen .pcg file here, or click Import.</div>
            {list.length === 0 && <p className="muted">No characters yet.</p>}
            <ul className="character-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => useCharactersUi.setState({ selectedId: c.id })}>
                    <span className="character-name">{c.name}</span>
                    <span className="muted small-text">{classSummary(c.build)}</span>
                    <span className="character-meta small-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span>{c.ownerId ? (users[c.ownerId]?.name ?? 'Unknown player') : 'GM (NPC)'}</span>
                      {c.tokenId && tokens[c.tokenId] && (
                        <>
                          <span>·</span>
                          <Link2 size={11} />
                          <span>{tokens[c.tokenId]!.name || 'token'}</span>
                        </>
                      )}
                      {c.shared && <span>· shared</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <p className="muted small-text">
            Characters are private to their player and the GM unless shared. In PCGen, use File → Save to export a .pcg file.
          </p>
        </>
      )}
    </div>
  );
}

const PLAY_TABS: [CharacterTab, string][] = [
  ['sheet', 'Sheet'],
  ['skills', 'Skills'],
  ['abilities', 'Abilities'],
  ['spells', 'Spells'],
  ['effects', 'Effects'],
  ['inventory', 'Inventory'],
];

const POPOUT_RIGHT_TABS: [CharacterTab, string][] = [
  ['skills', 'Skills'],
  ['abilities', 'Abilities'],
  ['spells', 'Spells'],
  ['effects', 'Effects'],
  ['inventory', 'Inventory'],
];

function AdminMenu({
  activeTab,
  manage,
  onSelect,
}: {
  activeTab: CharacterTab;
  manage: boolean;
  onSelect: (t: CharacterTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const items: [CharacterTab, string][] = [
    ...(manage ? ([['settings', 'Sheet settings'], ['manage', 'Manage & token']] as [CharacterTab, string][]) : []),
    ['imported', 'Imported .pcg data'],
  ];
  const isAdminActive = activeTab === 'settings' || activeTab === 'manage' || activeTab === 'imported';

  return (
    <div className="admin-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`icon-button${isAdminActive ? ' active' : ''}`}
        title="Settings, Manage & Imported data"
        aria-label="Character options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="admin-menu" role="menu">
          {items.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={activeTab === id ? 'active' : ''}
              onClick={() => {
                onSelect(id);
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CharacterView({ character: c, onBack }: { character: Character; onBack: () => void }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const tab = useCharactersUi((s) => s.tab);
  const poppedOut = useCharactersUi((s) => s.poppedOut);
  const setTab = (next: CharacterTab) => useCharactersUi.setState({ tab: next });
  const activeTab: CharacterTab = !manage && (tab === 'settings' || tab === 'manage') ? 'sheet' : tab;

  return (
    <section>
      <div className="character-header">
        <div className="character-header-left">
          <button type="button" className="link-button" onClick={onBack}>
            <ArrowLeft size={12} /> All characters
          </button>
          <h2 className="character-title" title={c.name}>
            {c.name}
          </h2>
        </div>
        <div className="character-header-actions">
          <button
            type="button"
            className="icon-button"
            title={poppedOut ? 'Dock back to sidebar' : 'Expand wide 2-column sheet'}
            aria-label={poppedOut ? 'Dock sheet' : 'Expand sheet'}
            onClick={() => useCharactersUi.setState({ poppedOut: !poppedOut, tab: tab === 'sheet' ? 'skills' : tab })}
          >
            {poppedOut ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <AdminMenu activeTab={activeTab} manage={manage} onSelect={setTab} />
        </div>
      </div>

      <div className="segmented sheet-tabs" role="tablist">
        {PLAY_TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'sheet' && (
        <CharacterSheet character={c} onOpenSettings={() => setTab('settings')} onOpenEffects={() => setTab('effects')} />
      )}
      {activeTab === 'skills' && <SkillsTab character={c} />}
      {activeTab === 'abilities' && <AbilitiesTab character={c} />}
      {activeTab === 'spells' && <SpellsTab character={c} />}
      {activeTab === 'effects' && <EffectsTab character={c} />}
      {activeTab === 'inventory' && <InventoryTab character={c} />}
      {activeTab === 'imported' && <CharacterSummary build={c.build} />}
      {activeTab === 'settings' && manage && <CharacterSettings character={c} />}
      {activeTab === 'manage' && manage && <ManageCharacter character={c} onBack={onBack} />}
    </section>
  );
}

/** Wide 2-column pop-out Character Sheet overlay: core stats pinned left, active tab on the right. */
export function CharacterPopout() {
  const list = useVisibleCharacters();
  const self = useSelf();
  const selectedId = useCharactersUi((s) => s.selectedId);
  const poppedOut = useCharactersUi((s) => s.poppedOut);
  const tab = useCharactersUi((s) => s.tab);
  const c = poppedOut ? list.find((x) => x.id === selectedId) : undefined;

  if (!c) return null;
  const manage = canManageCharacter(self, c);
  const setTab = (next: CharacterTab) => useCharactersUi.setState({ tab: next });
  const close = () => useCharactersUi.setState({ poppedOut: false });
  const rawRight: CharacterTab = tab === 'sheet' ? 'skills' : tab;
  const rightTab: CharacterTab = !manage && (rawRight === 'settings' || rawRight === 'manage') ? 'skills' : rawRight;

  return (
    <div className="sheet-popout-backdrop" onClick={close}>
      <div className="sheet-popout" role="dialog" aria-modal="true" aria-label={`${c.name} character sheet`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-popout-header">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
            <strong style={{ fontSize: 16 }}>{c.name}</strong>
            <span className="muted small-text">{classSummary(c.build)}</span>
          </div>
          <div className="character-header-actions">
            <AdminMenu activeTab={rightTab} manage={manage} onSelect={setTab} />
            <button type="button" className="icon-button" title="Close expanded sheet (Esc)" aria-label="Close" onClick={close}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="sheet-popout-body">
          <div className="sheet-popout-left">
            <CharacterSheet character={c} onOpenSettings={() => setTab('settings')} onOpenEffects={() => setTab('effects')} />
          </div>
          <div className="sheet-popout-right">
            <div className="sheet-popout-tabs">
              <div className="segmented sheet-tabs" role="tablist">
                {POPOUT_RIGHT_TABS.map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={rightTab === id} className={rightTab === id ? 'active' : ''} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sheet-popout-pane">
              {rightTab === 'skills' && <SkillsTab character={c} />}
              {rightTab === 'abilities' && <AbilitiesTab character={c} />}
              {rightTab === 'spells' && <SpellsTab character={c} />}
              {rightTab === 'effects' && <EffectsTab character={c} />}
              {rightTab === 'inventory' && <InventoryTab character={c} />}
              {rightTab === 'imported' && <CharacterSummary build={c.build} />}
              {rightTab === 'settings' && manage && <CharacterSettings character={c} />}
              {rightTab === 'manage' && manage && <ManageCharacter character={c} onBack={() => useCharactersUi.setState({ selectedId: null, poppedOut: false })} />}
            </div>
          </div>
        </div>
      </div>
    </div>
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
    useCharactersUi.setState({ poppedOut: false });
  }

  return (
    <div>
      <TextField
        label="Name in the VTT"
        value={c.name}
        onCommit={(raw) => {
          const name = raw.trim().slice(0, 80);
          if (name && dispatch(characterActions.update.create({ id: c.id, changes: { name } }))) syncLinkedToken({ ...c, name });
        }}
      />
      <div className="field">
        <label>Played by</label>
        {gm ? (
          <select
            value={c.ownerId ?? ''}
            onChange={(e) => {
              const ownerId = e.target.value || null;
              if (dispatch(characterActions.setOwner.create({ id: c.id, ownerId })) && ownerId && linked && !linked.ownerIds.includes(ownerId) && linked.ownerIds.length < 50) {
                dispatch(tokenActions.update.create({ id: linked.id, changes: { ownerIds: [...linked.ownerIds, ownerId] } }));
              }
            }}
          >
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
        Linking copies max HP, name, size, darkvision and initiative to the token. While linked, the token holds live HP.
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
            Sync token now
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
          onClick={async () => {
            if (await confirmDialog({ title: `Delete ${c.name}?`, message: 'Its token stays on the map, but the imported character sheet will be removed.', confirmLabel: 'Delete', danger: true })) {
              if (dispatch(characterActions.remove.create({ id: c.id }))) onBack();
            }
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
