import { panels } from '../panels';
import { useIsGm } from '../state/hooks';
import { useUi } from '../state/uiStore';

export function Sidebar() {
  const gm = useIsGm();
  const activeId = useUi((s) => s.sidebarPanel);
  const setPanel = useUi((s) => s.setSidebarPanel);
  const available = panels.filter((p) => gm || !p.gmOnly);
  const active = available.find((p) => p.id === activeId) ?? available[0];

  return (
    <aside className="sidebar">
      <nav className="tabs">
        {available.map((p) => (
          <button key={p.id} type="button" className={p.id === active?.id ? 'active' : ''} onClick={() => setPanel(p.id)}>
            {p.label}
          </button>
        ))}
      </nav>
      <div className="panel">{active && <active.Component />}</div>
    </aside>
  );
}
