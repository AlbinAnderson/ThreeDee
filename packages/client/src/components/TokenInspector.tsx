import { useMemo } from 'react';
import { canControlToken, isGm, tokenActions, type Token } from '@vtt/shared';
import { uploadAsset } from '../lib/assets';
import { dispatch } from '../state/dispatch';
import { useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { useUi } from '../state/uiStore';
import { CheckboxField, ColorField, ImageUploadButton, NumberField, TextField } from './fields';

/** Floating editor for the single selected token. */
export function TokenInspector() {
  const selected = useUi((s) => s.selectedTokenIds);
  const token = useGame((s) => (selected.length === 1 ? s.tokens[selected[0]!] : undefined));
  const self = useSelf();
  if (!token || !canControlToken(self, token)) return null;
  return <Inspector key={token.id} token={token} />;
}

function Inspector({ token }: { token: Token }) {
  const self = useSelf();
  const users = useGame((s) => s.users);
  const gm = isGm(self);
  const players = useMemo(() => Object.values(users).filter((u) => u.role !== 'gm'), [users]);

  const update = (changes: Parameters<typeof tokenActions.update.create>[0]['changes']) =>
    dispatch(tokenActions.update.create({ id: token.id, changes }));

  function toggleOwner(userId: string, owned: boolean) {
    const ownerIds = owned ? [...token.ownerIds, userId] : token.ownerIds.filter((id) => id !== userId);
    update({ ownerIds });
  }

  return (
    <div className="inspector">
      <div className="inspector-header">
        <strong>{token.name || 'Token'}</strong>
        <button type="button" className="icon-button" onClick={() => useUi.getState().clearSelection()} title="Close">
          ×
        </button>
      </div>
      <TextField label="Name" value={token.name} onCommit={(name) => update({ name })} />
      <div className="field-row">
        <ColorField label="Color" value={token.color} onCommit={(color) => update({ color })} />
        <NumberField label="Size" value={token.size} min={0.25} max={20} step={0.5} onCommit={(size) => update({ size })} />
      </div>
      <div className="button-row">
        <ImageUploadButton
          label={token.imageUrl ? 'Replace image' : 'Set image'}
          onFile={async (file) => {
            try {
              update({ imageUrl: await uploadAsset(file) });
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        />
        {token.imageUrl && (
          <button type="button" onClick={() => update({ imageUrl: null })}>
            Clear image
          </button>
        )}
      </div>
      <CheckboxField label="Show name" value={token.showName} onCommit={(showName) => update({ showName })} />
      {gm && (
        <>
          <CheckboxField label="Hidden from players" value={token.hidden} onCommit={(hidden) => update({ hidden })} />
          {players.length > 0 && (
            <fieldset className="owners">
              <legend>Controlled by</legend>
              {players.map((u) => (
                <CheckboxField
                  key={u.id}
                  label={u.name}
                  value={token.ownerIds.includes(u.id)}
                  onCommit={(owned) => toggleOwner(u.id, owned)}
                />
              ))}
            </fieldset>
          )}
        </>
      )}
      <button type="button" className="danger" onClick={() => dispatch(tokenActions.remove.create({ id: token.id }))}>
        Delete token
      </button>
    </div>
  );
}
