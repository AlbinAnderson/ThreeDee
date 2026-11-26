import { useMemo, useState } from 'react';
import { playerSections } from '../player';
import { useGameStore } from '../state/gameStore';
import { useGame, useSelf } from '../state/hooks';

/** Party roster on top; the selected player's page (pluggable sections) below. */
export function PlayersPanel() {
  const users = useGame((s) => s.users);
  const online = useGameStore((s) => s.online);
  const self = useSelf();
  const [selectedId, setSelectedId] = useState(self.id);
  const player = users[selectedId] ?? self;

  const sorted = useMemo(
    () =>
      Object.values(users).sort(
        (a, b) =>
          Number(online.includes(b.id)) - Number(online.includes(a.id)) ||
          Number(b.role === 'gm') - Number(a.role === 'gm') ||
          a.name.localeCompare(b.name),
      ),
    [users, online],
  );

  const sections = playerSections.filter((s) => !s.visible || s.visible(self, player));

  return (
    <div className="panel-scroll">
      <section>
        <h3>Players</h3>
        <ul className="player-list">
          {sorted.map((u) => (
            <li
              key={u.id}
              className={`${online.includes(u.id) ? 'online' : 'offline'}${u.id === player.id ? ' selected' : ''}`}
            >
              <button type="button" onClick={() => setSelectedId(u.id)}>
                <span className="status-dot" />
                <span className="swatch" style={{ background: u.color }} />
                <span className="player-name">{u.name}</span>
                {u.role === 'gm' && <span className="badge">GM</span>}
                {u.id === self.id && <span className="badge subtle">you</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className="player-page" key={player.id}>
        <h2>{player.id === self.id ? 'You' : player.name}</h2>
        {sections.map(({ id, title, Component }) => (
          <section key={id}>
            <h3>{title}</h3>
            <Component player={player} viewer={self} isSelf={player.id === self.id} />
          </section>
        ))}
      </div>
    </div>
  );
}
