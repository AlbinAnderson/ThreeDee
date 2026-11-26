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
      <div className="panel">
        <div className="panel-title">{active?.label}</div>
        {active && <active.Component />}
      </div>
      <nav className="rail" aria-label="Panels">
        {available.map((p) => (
          <button
            key={p.id}
            type="button"
            className={p.id === active?.id ? 'active' : ''}
            onClick={() => setPanel(p.id)}
            title={p.label}
            aria-label={p.label}
          >
            <span className="rail-icon">{p.icon}</span>
            <span className="rail-label">{p.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
