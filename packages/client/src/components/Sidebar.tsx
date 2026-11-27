import { useMemo, useState, type PointerEvent } from 'react';
import { canControlCombatant } from '@vtt/shared';
import { panels } from '../panels';
import { useGame, useIsGm, useSelf } from '../state/hooks';
import { SIDEBAR_DEFAULT, useUi } from '../state/uiStore';
import { PanelIcon } from './Icons';

const PLAY_PANEL_IDS = new Set(['chat', 'combat', 'actions', 'status', 'characters', 'loot']);

export function Sidebar() {
  const gm = useIsGm();
  const self = useSelf();
  const chat = useGame((s) => s.chat);
  const myTurn = useGame((s) => {
    const cb = s.combat.active ? s.combat.combatants.find((c) => c.id === s.combat.currentId) : undefined;
    return !!cb && canControlCombatant(s, self, cb);
  });
  const activeId = useUi((s) => s.sidebarPanel);
  const width = useUi((s) => s.sidebarWidth);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const lastSeenChatId = useUi((s) => s.lastSeenChatId);
  const setPanel = useUi((s) => s.setSidebarPanel);
  const [dragging, setDragging] = useState(false);

  const available = useMemo(() => panels.filter((p) => gm || !p.gmOnly), [gm]);
  const playPanels = useMemo(() => available.filter((p) => PLAY_PANEL_IDS.has(p.id)), [available]);
  const toolPanels = useMemo(() => available.filter((p) => !PLAY_PANEL_IDS.has(p.id)), [available]);
  const active = available.find((p) => p.id === activeId) ?? available[0];

  const unreadChat = useMemo(() => {
    if (!collapsed && active?.id === 'chat') return 0;
    if (!chat.length) return 0;
    if (!lastSeenChatId) return chat.length;
    const idx = chat.findIndex((m) => m.id === lastSeenChatId);
    return idx === -1 ? chat.length : Math.max(0, chat.length - 1 - idx);
  }, [collapsed, active?.id, chat, lastSeenChatId]);

  function onResizeStart(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const startX = e.clientX;
    const startW = useUi.getState().sidebarWidth;
    const onMove = (ev: globalThis.PointerEvent) => {
      useUi.getState().setSidebarWidth(startW + (startX - ev.clientX));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function clickRail(id: string) {
    if (!collapsed && active?.id === id) useUi.getState().setSidebarCollapsed(true);
    else setPanel(id);
  }

  const RAIL_SHORT: Record<string, string> = { characters: 'Chars', handouts: 'Handouts', random: 'Tables' };

  const renderRailButton = (p: (typeof available)[number]) => {
    const isActive = !collapsed && p.id === active?.id;
    return (
      <button
        key={p.id}
        type="button"
        className={isActive ? 'active' : ''}
        onClick={() => clickRail(p.id)}
        title={isActive ? `${p.label} (click to collapse)` : p.label}
        aria-label={p.label}
        aria-pressed={isActive}
      >
        <span className="rail-icon">
          <PanelIcon id={p.id} fallback={p.icon} />
        </span>
        <span className="rail-label">{RAIL_SHORT[p.id] ?? p.label.split(' ')[0]}</span>
        {p.id === 'chat' && unreadChat > 0 && <span className="rail-badge">{unreadChat > 9 ? '9+' : unreadChat}</span>}
        {p.id === 'actions' && myTurn && !isActive && <span className="rail-dot" title="Your turn!" />}
      </button>
    );
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} style={collapsed ? undefined : { width: width + 62 }}>
      {!collapsed && (
        <>
          <div
            className={`sidebar-resizer${dragging ? ' dragging' : ''}`}
            title="Drag to resize sidebar (double-click to reset)"
            onPointerDown={onResizeStart}
            onDoubleClick={() => useUi.getState().setSidebarWidth(SIDEBAR_DEFAULT)}
          />
          <div className="panel">
            <div className="panel-title">
              <span>{active?.label}</span>
            </div>
            {active && <active.Component />}
          </div>
        </>
      )}
      <nav className="rail" aria-label="Panels">
        {playPanels.map(renderRailButton)}
        {toolPanels.length > 0 && <div className="rail-sep" role="separator" />}
        {toolPanels.map(renderRailButton)}
      </nav>
    </aside>
  );
}
