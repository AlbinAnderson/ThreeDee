import { userActions } from '@vtt/shared';
import { ColorField, TextField } from '../components/fields';
import { dispatch } from '../state/dispatch';
import type { PlayerSectionProps } from './types';

export function ProfileSection({ player, isSelf }: PlayerSectionProps) {
  if (!isSelf) {
    return (
      <p className="muted">
        <span className="swatch" style={{ background: player.color }} /> {player.role === 'gm' ? 'Game master' : 'Player'}
      </p>
    );
  }
  return (
    <>
      <TextField label="Name" value={player.name} onCommit={(name) => dispatch(userActions.updateSelf.create({ name }))} />
      <ColorField label="Color" value={player.color} onCommit={(color) => dispatch(userActions.updateSelf.create({ color }))} />
    </>
  );
}
