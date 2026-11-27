import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, BookOpen, Crosshair, Link2, Maximize2, Minimize2, MoreVertical, PawPrint, Upload, X } from 'lucide-react';
import {
  canControlToken,
  canManageCharacter,
  characterActions,
  classSummary,
  COMPANION_TYPE_LABEL,
  companionsOf,
  HARBOR_LABEL,
  isGm,
  tokenActions,
  type Character,
} from '@vtt/shared';
import { CheckboxField, TextField } from '../components/fields';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { useGameStore } from '../state/gameStore';
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
import { CompanionStrip, CompanionsTab } from './CompanionsTab';
import { BioTab } from './BioTab';
import { openImport } from './ImportDialog';
import { useCharactersUi, type CharacterTab } from './store';

/**
 * Characters grouped under their masters (companions right after their master,
 * indented by depth). A companion whose master you can't see is listed at the top level.
 */
export function groupByMaster(list: Character[]): { character: Character; depth: number }[] {
  const ids = new Set(list.map((c) => c.id));
  const children = new Map<string, Character[]>();
  for (const c of list) {
    const m = c.companion?.masterId;
    if (m && ids.has(m)) children.set(m, [...(children.get(m) ?? []), c]);
  }
  const out: { character: Character; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (c: Character, depth: number) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push({ character: c, depth });
    for (const k of children.get(c.id) ?? []) walk(k, depth + 1);
  };
  for (const c of list) if (!c.companion || !ids.has(c.companion.masterId)) walk(c, 0);
  for (const c of list) walk(c, 0); // anything left over (shouldn't happen: cycles are refused)
  return out;
}

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
              {groupByMaster(list).map(({ character: c, depth }) => (
                <li key={c.id} className={depth > 0 ? 'companion-item' : undefined} style={depth > 0 ? { paddingLeft: Math.min(depth, 3) * 14 } : undefined}>
                  <button type="button" onClick={() => useCharactersUi.setState({ selectedId: c.id })}>
                    <span className="character-name">
                      {c.bio.portraitUrl && <img className="character-avatar small" src={c.bio.portraitUrl} alt="" />}
                      {c.companion && <PawPrint size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}
                      {c.name}
                      {c.companion && <span className="badge subtle" style={{ marginLeft: 6 }}>{COMPANION_TYPE_LABEL[c.companion.type]}</span>}
                      {c.companion?.harbored && <span className="badge warn" style={{ marginLeft: 4 }}>{HARBOR_LABEL[c.companion.type]}</span>}
                    </span>
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
  ['companions', 'Companions'],
  ['bio', 'Bio & notes'],
];

/** Tabs shown as an icon only (the sidebar is narrow). */
const ICON_TABS: Partial<Record<CharacterTab, typeof PawPrint>> = { companions: PawPrint, bio: BookOpen };

const POPOUT_RIGHT_TABS: [CharacterTab, string][] = [
  ['skills', 'Skills'],
  ['abilities', 'Abilities'],
  ['spells', 'Spells'],
  ['effects', 'Effects'],
  ['inventory', 'Inventory'],
  ['companions', 'Companions'],
  ['bio', 'Bio'],
];

/** Quick switch between the characters you can see (companions under their masters). */
function CharacterSwitcher({ current }: { current: Character }) {
  const list = useVisibleCharacters();
  if (list.length < 2) return null;
  return (
    <select
      className="character-switcher"
      value={current.id}
      aria-label="Switch character"
      title="Switch character"
      onChange={(e) => useCharactersUi.setState({ selectedId: e.target.value })}
    >
      {groupByMaster(list).map(({ character: c, depth }) => (
        <option key={c.id} value={c.id}>
          {`${'\u00a0\u00a0'.repeat(Math.min(depth, 3))}${depth > 0 ? '↳ ' : ''}${c.name}`}
        </option>
      ))}
    </select>
  );
}

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

function useCharacterTabBadges(c: Character) {
  const characters = useGame((s) => s.characters);
  const tokens = useGame((s) => s.tokens);
  const token = c.tokenId ? tokens[c.tokenId] : undefined;
  const activeBuffs = c.runtime.buffs.filter((b) => b.active).length;
  const activeConditions = (token?.conditions ?? c.runtime.conditions).length;
  const companionCount = useMemo(() => companionsOf({ characters }, c.id).length, [characters, c.id]);
  return { effects: activeBuffs + activeConditions, companions: companionCount };
}

function CharacterView({ character: c, onBack }: { character: Character; onBack: () => void }) {
  const self = useSelf();
  const manage = canManageCharacter(self, c);
  const tab = useCharactersUi((s) => s.tab);
  const poppedOut = useCharactersUi((s) => s.poppedOut);
  const setTab = (next: CharacterTab) => useCharactersUi.setState({ tab: next });
  const activeTab: CharacterTab = !manage && (tab === 'settings' || tab === 'manage') ? 'sheet' : tab;
  const badges = useCharacterTabBadges(c);

  return (
    <section>
      <div className="character-header">
        <div className="character-header-left">
          <button type="button" className="link-button" onClick={onBack}>
            <ArrowLeft size={12} /> All characters
          </button>
          <h2 className="character-title" title={c.name}>
            {c.bio.portraitUrl && <img className="character-avatar" src={c.bio.portraitUrl} alt="" />}
            {c.name}
          </h2>
        </div>
        <div className="character-header-actions">
          <CharacterSwitcher current={c} />
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

      <CompanionStrip character={c} />

      <div className="segmented sheet-tabs" role="tablist">
        {PLAY_TABS.map(([id, label]) => {
          const Icon = ICON_TABS[id];
          const count = id === 'effects' ? badges.effects : id === 'companions' ? badges.companions : 0;
          return (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} aria-label={label} title={Icon ? label : undefined} className={activeTab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {Icon ? <Icon size={13} /> : label}
              {count > 0 && <span className="sheet-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {activeTab === 'sheet' && (
        <CharacterSheet character={c} onOpenSettings={() => setTab('settings')} onOpenEffects={() => setTab('effects')} />
      )}
      {activeTab === 'skills' && <SkillsTab character={c} />}
      {activeTab === 'abilities' && <AbilitiesTab character={c} />}
      {activeTab === 'spells' && <SpellsTab character={c} />}
      {activeTab === 'effects' && <EffectsTab character={c} />}
      {activeTab === 'inventory' && <InventoryTab character={c} />}
      {activeTab === 'companions' && <CompanionsTab character={c} />}
      {activeTab === 'bio' && <BioTab character={c} />}
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
  const gm = isGm(self);
  const tokens = useGame((s) => s.tokens);
  const activeSceneId = useGame((s) => s.activeSceneId);
  const viewedSceneId = useUi((s) => s.viewedSceneId);
  const selectedId = useCharactersUi((s) => s.selectedId);
  const poppedOut = useCharactersUi((s) => s.poppedOut);
  const tab = useCharactersUi((s) => s.tab);
  const c = poppedOut ? list.find((x) => x.id === selectedId) : undefined;

  if (!c) return null;
  return <CharacterPopoutBody character={c} tab={tab} gm={gm} self={self} tokens={tokens} currentSceneId={gm ? (viewedSceneId ?? activeSceneId) : activeSceneId} />;
}

function CharacterPopoutBody({
  character: c,
  tab,
  gm,
  self,
  tokens,
  currentSceneId,
}: {
  character: Character;
  tab: CharacterTab;
  gm: boolean;
  self: ReturnType<typeof useSelf>;
  tokens: Record<string, import('@vtt/shared').Token>;
  currentSceneId: string | null;
}) {
  const manage = canManageCharacter(self, c);
  const setTab = (next: CharacterTab) => useCharactersUi.setState({ tab: next });
  const close = () => useCharactersUi.setState({ poppedOut: false });
  const rawRight: CharacterTab = tab === 'sheet' ? 'skills' : tab;
  const rightTab: CharacterTab = !manage && (rawRight === 'settings' || rawRight === 'manage') ? 'skills' : rawRight;
  const badges = useCharacterTabBadges(c);
  const linked = c.tokenId ? tokens[c.tokenId] : undefined;
  const canJumpToken = !!linked && (gm || linked.sceneId === currentSceneId);

  function selectLinkedToken() {
    if (!linked) return;
    if (linked.sceneId !== currentSceneId) {
      if (!gm) return;
      useUi.getState().setViewedScene(linked.sceneId);
    }
    useUi.getState().setSelection([linked.id]);
    close();
  }

  return (
    <div className="sheet-popout-backdrop" onClick={close}>
      <div className="sheet-popout" role="dialog" aria-modal="true" aria-label={`${c.name} character sheet`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-popout-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {c.bio.portraitUrl && <img className="character-avatar" src={c.bio.portraitUrl} alt="" style={{ marginRight: 0 }} />}
            <strong style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</strong>
            <span className="muted small-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{classSummary(c.build)}</span>
          </div>
          <div className="character-header-actions">
            <CharacterSwitcher current={c} />
            {canJumpToken && (
              <button type="button" className="icon-button" title="Select linked token on map" aria-label="Select token on map" onClick={selectLinkedToken}>
                <Crosshair size={15} />
              </button>
            )}
            <AdminMenu activeTab={rightTab} manage={manage} onSelect={setTab} />
            <button type="button" className="icon-button" title="Close expanded sheet (Esc)" aria-label="Close" onClick={close}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="sheet-popout-body">
          <div className="sheet-popout-left">
            <CompanionStrip character={c} />
            <CharacterSheet character={c} onOpenSettings={() => setTab('settings')} onOpenEffects={() => setTab('effects')} />
          </div>
          <div className="sheet-popout-right">
            <div className="sheet-popout-tabs">
              <div className="segmented sheet-tabs" role="tablist">
                {POPOUT_RIGHT_TABS.map(([id, label]) => {
                  const count = id === 'effects' ? badges.effects : id === 'companions' ? badges.companions : 0;
                  return (
                    <button key={id} type="button" role="tab" aria-selected={rightTab === id} className={rightTab === id ? 'active' : ''} onClick={() => setTab(id)}>
                      {label}
                      {count > 0 && <span className="sheet-tab-count">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="sheet-popout-pane">
              {rightTab === 'skills' && <SkillsTab character={c} />}
              {rightTab === 'abilities' && <AbilitiesTab character={c} />}
              {rightTab === 'spells' && <SpellsTab character={c} />}
              {rightTab === 'effects' && <EffectsTab character={c} />}
              {rightTab === 'inventory' && <InventoryTab character={c} />}
              {rightTab === 'companions' && <CompanionsTab character={c} />}
              {rightTab === 'bio' && <BioTab character={c} />}
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
            onChange={async (e) => {
              const ownerId = e.target.value || null;
              const characters = Object.values(useGameStore.getState().view?.characters ?? {});
              const master = c.companion ? characters.find((m) => m.id === c.companion!.masterId) : undefined;
              const broken = [...(master && master.ownerId !== ownerId ? [master] : []), ...characters.filter((x) => x.companion?.masterId === c.id && x.ownerId !== ownerId)];
              if (
                broken.length > 0 &&
                !(await confirmDialog({
                  title: 'Unlink companions?',
                  message: `A companion is played by its master's player, so this unlinks ${c.name} from ${broken.map((x) => x.name).join(', ')}. Hand those over too to keep them together.`,
                  confirmLabel: 'Change player',
                }))
              )
                return;
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
