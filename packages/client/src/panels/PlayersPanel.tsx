import { useMemo } from 'react';
import { userActions } from '@vtt/shared';
import { ColorField, TextField } from '../components/fields';
import { dispatch } from '../state/dispatch';
import { useGameStore } from '../state/gameStore';
import { useGame, useSelf } from '../state/hooks';

export function PlayersPanel() {
  const users = useGame((s) => s.users);
  const online = useGameStore((s) => s.online);
  const self = useSelf();

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

  return (
    <div className="panel-scroll">
      <section>
        <h3>You</h3>
        <TextField label="Name" value={self.name} onCommit={(name) => dispatch(userActions.updateSelf.create({ name }))} />
        <ColorField label="Color" value={self.color} onCommit={(color) => dispatch(userActions.updateSelf.create({ color }))} />
      </section>
      <section>
        <h3>Players</h3>
        <ul className="player-list">
          {sorted.map((u) => (
            <li key={u.id} className={online.includes(u.id) ? 'online' : 'offline'}>
              <span className="status-dot" />
              <span className="swatch" style={{ background: u.color }} />
              <span className="player-name">{u.name}</span>
              {u.role === 'gm' && <span className="badge">GM</span>}
              {u.id === self.id && <span className="badge subtle">you</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
