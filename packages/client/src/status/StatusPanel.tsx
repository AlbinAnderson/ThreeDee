import { useIsGm } from '../state/hooks';
import { statusSections } from '.';

export function StatusPanel() {
  const gm = useIsGm();
  const sections = statusSections.filter((s) => gm || !s.gmOnly);
  return (
    <div className="panel-scroll">
      {sections.length === 0 && <p className="muted">Nothing tracked here yet.</p>}
      {sections.map(({ id, title, Component }) => (
        <section key={id}>
          <h3>{title}</h3>
          <Component />
        </section>
      ))}
    </div>
  );
}
