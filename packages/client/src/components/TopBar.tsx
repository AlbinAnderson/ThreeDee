import { Dices, EyeOff, Globe, Keyboard, Lock, LogOut, PanelRightClose, PanelRightOpen, Swords } from 'lucide-react';
import { canControlCombatant, combatantName } from '@vtt/shared';
import { useCurrentScene, useGame, useIsGm, useSelf } from '../state/hooks';
import { leaveRoom, useSession } from '../state/session';
import { useUi } from '../state/uiStore';

export function TopBar() {
  const status = useSession((s) => s.status);
  const roomId = useSession((s) => s.connection?.params.roomId);
  const gm = useIsGm();
  const self = useSelf();
  const state = useGame((s) => s);
  const scene = useCurrentScene();
  const activeId = state.activeSceneId;
  const activeName = activeId ? state.scenes[activeId]?.name : undefined;
  const viewingOther = gm && scene && scene.id !== activeId;

  const chatMode = useUi((s) => s.chatMode);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);

  const combat = state.combat;
  const currentCb = combat.active ? combat.combatants.find((c) => c.id === combat.currentId) : undefined;
  const myTurn = !!currentCb && canControlCombatant(state, self, currentCb);
  const currentName = currentCb ? combatantName(state, currentCb) : null;

  const whisperRecipient = chatMode.mode === 'whisper' && chatMode.to[0] ? state.users[chatMode.to[0]]?.name : null;
  const chatLabel =
    chatMode.mode === 'public' ? 'Public rolls' : chatMode.mode === 'gm' ? 'GM only' : whisperRecipient ? `Whisper: ${whisperRecipient}` : 'Whisper';

  function cycleChatMode() {
    const ui = useUi.getState();
    if (chatMode.mode === 'public') ui.setChatMode({ mode: 'gm', to: [] });
    else ui.setChatMode({ mode: 'public', to: [] });
  }

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
        {combat.active && currentName && (
          <button
            type="button"
            className={`turn-pill${myTurn ? ' mine' : ''}`}
            title={myTurn ? 'Your turn — open Actions' : 'Active combat — open Combat tracker'}
            onClick={() => useUi.getState().setSidebarPanel(myTurn ? 'actions' : 'combat')}
          >
            <Swords size={13} />
            <span>
              R{combat.round} · {myTurn ? `Your turn (${currentName})` : currentName}
            </span>
          </button>
        )}

        <button
          type="button"
          className={`chat-mode-pill${chatMode.mode !== 'public' ? ' private' : ''}`}
          title="Current roll & chat visibility. Click to toggle Public / GM only."
          onClick={cycleChatMode}
        >
          {chatMode.mode === 'public' ? <Globe size={12} /> : chatMode.mode === 'gm' ? <Lock size={12} /> : <EyeOff size={12} />}
          <span>{chatLabel}</span>
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
