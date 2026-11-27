import { useMemo, useState } from 'react';
import { createToken, isGm, newId, snapTokenPosition, tokenActions } from '@vtt/shared';
import { ColorField, ImageUploadButton, NumberField, TextField } from '../components/fields';
import { uploadAsset } from '../lib/assets';
import { dispatch } from '../state/dispatch';
import { useCurrentScene, useGame, useSelf } from '../state/hooks';
import { notify } from '../state/notifications';
import { useUi, viewportCenterWorld } from '../state/uiStore';
import { focusToken } from '../lib/tokens';

export function TokensPanel() {
  const scene = useCurrentScene();
  const self = useSelf();
  const tokens = useGame((s) => s.tokens);
  const selected = useUi((s) => s.selectedTokenIds);
  const setSelection = useUi((s) => s.setSelection);

  const [name, setName] = useState('');
  const [color, setColor] = useState(self.color);
  const [size, setSize] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const sceneTokens = useMemo(
    () =>
      Object.values(tokens)
        .filter((t) => t.sceneId === scene?.id && (isGm(self) || !t.hidden))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tokens, scene?.id, self],
  );

  if (!scene) return <p className="muted">No scene.</p>;

  function addToken() {
    if (!scene) return;
    const px = size * scene.grid.size;
    const center = viewportCenterWorld();
    const pos = snapTokenPosition({ x: center.x - px / 2, y: center.y - px / 2 }, scene.grid);
    const token = createToken({
      id: newId(),
      sceneId: scene.id,
      name: name.trim() || 'Token',
      imageUrl,
      color,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      size,
      ownerIds: isGm(self) ? [] : [self.id],
    });
    if (dispatch(tokenActions.create.create({ token }))) {
      setSelection([token.id]);
      setName('');
      setImageUrl(null);
    }
  }

  return (
    <div className="panel-scroll">
      <section>
        <h3>Add token</h3>
        <TextField label="Name" value={name} onCommit={setName} placeholder="Token" />
        <div className="field-row">
          <ColorField label="Color" value={color} onCommit={setColor} />
          <NumberField label="Size (cells)" value={size} min={0.25} max={20} step={0.5} onCommit={setSize} />
        </div>
        <div className="button-row">
          <ImageUploadButton
            label={imageUrl ? 'Change image' : 'Image (optional)'}
            onFile={async (file) => {
              try {
                setImageUrl(await uploadAsset(file));
              } catch (e) {
                notify((e as Error).message);
              }
            }}
          />
          {imageUrl && <img className="thumb" src={imageUrl} alt="" />}
        </div>
        <button type="button" className="primary" onClick={addToken}>
          Place in view
        </button>
      </section>
      <section>
        <h3>On this scene</h3>
        {sceneTokens.length === 0 && <p className="muted">No tokens yet.</p>}
        <ul className="token-list">
          {sceneTokens.map((t) => (
            <li key={t.id} className={selected.includes(t.id) ? 'selected' : ''}>
              <button type="button" title="Select and center on map" onClick={() => focusToken(t.id)}>
                <span className="swatch" style={{ background: t.color }} />
                {t.name || '(unnamed)'}
                {t.hidden && <span className="badge subtle">hidden</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
