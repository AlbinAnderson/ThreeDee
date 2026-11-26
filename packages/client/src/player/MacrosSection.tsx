import { useMemo, useState, type FormEvent } from 'react';
import { macroActions, newId, type Macro } from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { rollToChat } from '../panels/ChatPanel';
import type { PlayerSectionProps } from './types';

export function useMacros(ownerId: string): Macro[] {
  const macros = useGame((s) => s.macros);
  return useMemo(() => Object.values(macros).filter((m) => m.ownerId === ownerId), [macros, ownerId]);
}

/** A player's saved rolls: roll with a click, edit inline. They also appear in the hotbar. */
export function MacrosSection({ player, viewer }: PlayerSectionProps) {
  const macros = useMacros(player.id);
  const canEdit = viewer.id === player.id || viewer.role === 'gm';
  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');

  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !formula.trim()) return;
    const ok = dispatch(macroActions.create.create({ macro: { id: newId(), ownerId: player.id, name: name.trim().slice(0, 40), formula: formula.trim() } }));
    if (ok) {
      setName('');
      setFormula('');
    }
  }

  return (
    <div>
      {macros.length === 0 && <p className="muted small-text">No saved rolls yet, e.g. “Longsword” · 1d20+5.</p>}
      <ul className="macro-list">
        {macros.map((m) => (
          <li key={m.id}>
            <button type="button" className="small" onClick={() => rollToChat(m.formula, m.name)} title={`Roll ${m.formula}`}>
              🎲
            </button>
            <span className="macro-name">{m.name}</span>
            <code className="macro-formula">{m.formula}</code>
            {canEdit && (
              <button type="button" className="icon-button" title="Delete" onClick={() => dispatch(macroActions.remove.create({ id: m.id }))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form className="field-row macro-form" onSubmit={add}>
          <input placeholder="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <input placeholder="1d20+5" value={formula} maxLength={200} onChange={(e) => setFormula(e.target.value)} />
          <button type="submit" className="small">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

/** One-click buttons for your saved rolls, along the bottom of the board. */
export function Hotbar() {
  const self = useSelf();
  const macros = useMacros(self.id);
  if (!macros.length) return null;
  return (
    <div className="hotbar">
      {macros.slice(0, 12).map((m) => (
        <button key={m.id} type="button" onClick={() => rollToChat(m.formula, m.name)} title={`${m.formula} (uses your chat mode)`}>
          {m.name}
        </button>
      ))}
    </div>
  );
}
