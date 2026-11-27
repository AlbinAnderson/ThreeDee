import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useIsGm } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { tools } from '../tools';

export function ShortcutsModal() {
  const open = useUi((s) => s.shortcutsOpen);
  const gm = useIsGm();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useUi.getState().setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const visibleTools = tools.filter((t) => (gm || !t.gmOnly) && t.hotkey);
  const general: [string, string][] = [
    ['Space + Drag', 'Pan the map'],
    ['Mouse wheel', 'Zoom in / out'],
    ['Ctrl + K', 'PF1e Rules & Compendium'],
    ['[', 'Collapse / expand sidebar'],
    ['?', 'Toggle keyboard shortcuts'],
    ['Esc', 'Close top modal / clear selection'],
    ['Delete', 'Remove selected token(s)'],
  ];

  return (
    <div className="modal-backdrop" onClick={() => useUi.getState().setShortcutsOpen(false)}>
      <div className="modal" style={{ width: 'min(520px, 94vw)' }} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="inspector-header">
          <strong>Keyboard shortcuts</strong>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => useUi.getState().setShortcutsOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <h3>Navigation &amp; Workspace</h3>
        <div className="shortcuts-grid">
          {general.map(([key, label]) => (
            <div key={key} className="shortcut-row">
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
        <h3 style={{ marginTop: 14 }}>Board Tools</h3>
        <div className="shortcuts-grid">
          {visibleTools.map((t) => (
            <div key={t.id} className="shortcut-row">
              <span>{t.label}</span>
              <kbd>{t.hotkey!.toUpperCase()}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
