/** Status tab: active buffs and conditions of every character you can see, with rounds left. */
import { useMemo } from 'react';
import { computeCharacterStats } from '@vtt/shared';
import { useGame } from '../state/hooks';

export function EffectsSection() {
  const characters = useGame((s) => s.characters);
  const rows = useMemo(
    () =>
      Object.values(characters)
        .map((c) => ({ c, sources: computeCharacterStats(c).effects.sources }))
        .filter((r) => r.sources.length > 0)
        .sort((a, b) => a.c.name.localeCompare(b.c.name)),
    [characters],
  );
  if (!rows.length) return <p className="muted">No active buffs or conditions.</p>;
  return (
    <ul className="status-list">
      {rows.map(({ c, sources }) => (
        <li key={c.id}>
          <span className="status-row">
            <span className="status-name">{c.name}</span>
          </span>
          <span className="active-effects">
            {sources.map((s, i) => (
              <span key={`${s.kind}|${s.name}|${i}`} className={`badge${s.kind === 'condition' ? ' warn' : ''}`}>
                {s.name}
                {s.roundsLeft !== null ? ` ⏱${s.roundsLeft}` : ''}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
