import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { BookOpen, Check, ChevronDown, Dices, EyeOff, Globe, Keyboard, Lock, LogOut, PanelRightClose, PanelRightOpen, Swords } from 'lucide-react';
import { canControlCombatant, combatantName, isGm, type User } from '@vtt/shared';
import { useDialogStore } from '../state/dialogs';
import { useGameStore } from '../state/gameStore';
import { useRulesUi } from '../rules/store';
import { useCurrentScene, useGame, useIsGm, useSelf } from '../state/hooks';
import { leaveRoom, useSession } from '../state/session';
import { useUi, type ChatMode } from '../state/uiStore';

export function TopBar() {
  const status = useSession((s) => s.status);
  const roomId = useSession((s) => s.connection?.params.roomId);
  const gm = useIsGm();
  const self = useSelf();
  const scene = useCurrentScene();
  const activeId = useGame((s) => s.activeSceneId);
  const activeName = useGame((s) => (s.activeSceneId ? s.scenes[s.activeSceneId]?.name : undefined));
  const users = useGame((s) => s.users);
  const combatActive = useGame((s) => s.combat.active);
  const combatRound = useGame((s) => s.combat.round);
  const myTurn = useGame((s) => {
    const cb = s.combat.active ? s.combat.combatants.find((c) => c.id === s.combat.currentId) : undefined;
    return !!cb && canControlCombatant(s, self, cb);
  });
  const currentName = useGame((s) => {
    const cb = s.combat.active ? s.combat.combatants.find((c) => c.id === s.combat.currentId) : undefined;
    return cb ? combatantName(s, cb) : null;
  });
  const viewingOther = gm && scene && scene.id !== activeId;

  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);


  return (
    <header className="topbar">
      <span className="room-pill" title={`Room: ${roomId}`}>
        <Dices size={14} />
        {roomId}
      </span>

      <span className="scene-title">
        <strong>{scene?.name ?? 'No scene'}</strong>
        {viewingOther && (
          <>
            <span className="badge warn">GM preview</span>
            <span className="muted small-text">Players see: {activeName ?? 'nothing'}</span>
            <button type="button" className="small" onClick={() => useUi.getState().setViewedScene(null)}>
              Back to live
            </button>
          </>
        )}
      </span>

      <div className="topbar-pills">
        {combatActive && currentName && (
          <button
            type="button"
            className={`turn-pill${myTurn ? ' mine' : ''}`}
            title={myTurn ? 'Your turn — open Actions' : 'Active combat — open Combat tracker'}
            onClick={() => useUi.getState().setSidebarPanel(myTurn ? 'actions' : 'combat')}
          >
            <Swords size={13} />
            <span>
              R{combatRound} · {myTurn ? `Your turn (${currentName})` : currentName}
            </span>
          </button>
        )}

        <ChatModeMenu users={users} selfId={self.id} />

        <button
          type="button"
          className="rules-pill"
          title="PF1e Rules & Compendium (Ctrl+K)"
          aria-label="PF1e Rules & Compendium"
          onClick={() => useRulesUi.getState().openCompendium()}
        >
          <BookOpen size={13} />
          <span>Rules</span>
          <kbd className="topbar-kbd">Ctrl+K</kbd>
        </button>

        <button
          type="button"
          className="icon-button"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={() => useUi.getState().setShortcutsOpen(true)}
        >
          <Keyboard size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title={sidebarCollapsed ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => useUi.getState().toggleSidebar()}
        >
          {sidebarCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
        </button>
      </div>

      <span className={`conn-status ${status}`} title={status === 'open' ? 'Connected' : status}>
        <span className="conn-dot" />
        <span>{status === 'open' ? 'Live' : status === 'connecting' ? 'Reconnecting…' : status}</span>
      </span>

      <button type="button" className="small" title="Leave room" onClick={leaveRoom}>
        <LogOut size={13} />
        Leave
      </button>
    </header>
  );
}

function sameMode(a: ChatMode, b: ChatMode) {
  return a.mode === b.mode && (a.mode !== 'whisper' || a.to[0] === b.to[0]);
}

/** Top-bar pill showing who sees your rolls & messages, with an anchored picker. */
function ChatModeMenu({ users, selfId }: { users: Record<string, User>; selfId: string }) {
  const chatMode = useUi((s) => s.chatMode);
  const online = useGameStore((s) => s.online);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const others = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.id !== selfId)
        .sort((a, b) => Number(isGm(b)) - Number(isGm(a)) || a.name.localeCompare(b.name)),
    [users, selfId],
  );

  const recipient = chatMode.mode === 'whisper' && chatMode.to[0] ? users[chatMode.to[0]]?.name : null;
  const label = chatMode.mode === 'public' ? 'Public rolls' : chatMode.mode === 'gm' ? 'GM only' : recipient ? `Whisper: ${recipient}` : 'Whisper';

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) pillRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so the popover consumes Escape before TableView clears the selection.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useDialogStore.getState().current) return;
      // A rules modal or shortcuts modal opened on top closes first.
      const rules = useRulesUi.getState();
      if (rules.card || rules.compendiumOpen || useUi.getState().shortcutsOpen) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close(true);
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    // Focus the current choice so arrow keys work straight away.
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function choose(mode: ChatMode) {
    useUi.getState().setChatMode(mode);
    close(true);
  }

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]!.focus();
  }

  const option = (mode: ChatMode, icon: ReactNode, text: string, hint?: ReactNode) => {
    const active = sameMode(chatMode, mode);
    return (
      <button type="button" role="menuitemradio" aria-checked={active} className={`chat-mode-option${active ? ' active' : ''}`} onClick={() => choose(mode)}>
        <span className="chat-mode-option-icon">{icon}</span>
        <span className="chat-mode-option-text">{text}</span>
        {hint}
        <span className="chat-mode-option-check">{active && <Check size={13} />}</span>
      </button>
    );
  };

  return (
    <div className="chat-mode-anchor" ref={wrapRef}>
      <button
        ref={pillRef}
        type="button"
        className={`chat-mode-pill${chatMode.mode !== 'public' ? ' private' : ''}${open ? ' open' : ''}`}
        title="Who sees your rolls & chat messages"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {chatMode.mode === 'public' ? <Globe size={12} /> : chatMode.mode === 'gm' ? <Lock size={12} /> : <EyeOff size={12} />}
        <span>{label}</span>
        <ChevronDown size={12} className="chat-mode-caret" />
      </button>
      {open && (
        <div className="chat-mode-popover" role="menu" aria-label="Roll & chat visibility" ref={menuRef} onKeyDown={onMenuKey}>
          {option({ mode: 'public', to: [] }, <Globe size={13} />, 'Public rolls', <span className="chat-mode-option-hint">Everyone</span>)}
          {option({ mode: 'gm', to: [] }, <Lock size={13} />, 'GM only', <span className="chat-mode-option-hint">Private to GM</span>)}
          <div className="chat-mode-divider" role="separator" />
          <div className="chat-mode-heading">Whisper to</div>
          {others.length === 0 && <div className="chat-mode-empty">Nobody else in the room yet.</div>}
          {others.map((u) => {
            const isOnline = online.includes(u.id);
            return (
              <div key={u.id} role="none">
                {option(
                  { mode: 'whisper', to: [u.id] },
                  <span className={`chat-mode-presence${isOnline ? ' online' : ''}`} title={isOnline ? 'Online' : 'Offline'} />,
                  u.name,
                  isGm(u) ? <span className="chat-mode-option-hint">GM</span> : undefined,
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
