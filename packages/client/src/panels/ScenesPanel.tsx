import { createScene, fogActions, newId, sceneActions, type DiagonalRule, type Scene } from '@vtt/shared';
import { CheckboxField, ColorField, ImageUploadButton, NumberField, SelectField, TextField } from '../components/fields';
import { loadImageSize, uploadAsset } from '../lib/assets';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useCurrentScene, useGame } from '../state/hooks';
import { notify } from '../state/notifications';
import { useUi } from '../state/uiStore';

const DIAGONAL_OPTIONS: { value: DiagonalRule; label: string }[] = [
  { value: 'chebyshev', label: 'Diagonals = 1 (1-1-1)' },
  { value: 'alternating', label: 'Alternating (1-2-1-2)' },
  { value: 'manhattan', label: 'No diagonals' },
  { value: 'euclidean', label: 'Straight-line' },
];

export function ScenesPanel() {
  const scenes = useGame((s) => s.scenes);
  const order = useGame((s) => s.sceneOrder);
  const activeId = useGame((s) => s.activeSceneId);
  const current = useCurrentScene();
  const setViewedScene = useUi((s) => s.setViewedScene);

  function addScene() {
    const scene = createScene(newId(), `Scene ${order.length + 1}`);
    if (dispatch(sceneActions.create.create({ scene }))) setViewedScene(scene.id);
  }

  return (
    <div className="panel-scroll">
      <section>
        <div className="section-header">
          <h3>Scenes</h3>
          <button type="button" onClick={addScene}>
            + New
          </button>
        </div>
        <ul className="scene-list">
          {order.map((id) => {
            const s = scenes[id];
            if (!s) return null;
            return (
              <li key={id} className={current?.id === id ? 'viewing' : ''}>
                <button type="button" className="scene-name" onClick={() => setViewedScene(id)} title="View locally">
                  {s.name}
                </button>
                {activeId === id ? (
                  <span className="badge" title="Players are on this scene">
                    LIVE
                  </span>
                ) : (
                  <button
                    type="button"
                    className="small"
                    title="Move all players to this scene"
                    onClick={() => dispatch(sceneActions.activate.create({ id }))}
                  >
                    Show players
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="muted small-text">Click a scene to view it yourself; players only see the LIVE scene.</p>
      </section>
      {current && <SceneSettings key={current.id} scene={current} />}
    </div>
  );
}

function SceneSettings({ scene }: { scene: Scene }) {
  const update = (changes: Parameters<typeof sceneActions.update.create>[0]['changes']) =>
    dispatch(sceneActions.update.create({ id: scene.id, changes }));
  const updateGrid = (changes: Parameters<typeof sceneActions.updateGrid.create>[0]['changes']) =>
    dispatch(sceneActions.updateGrid.create({ id: scene.id, changes }));

  async function setBackground(file: File) {
    try {
      const url = await uploadAsset(file);
      const { width, height } = await loadImageSize(url);
      update({ background: url, width, height });
    } catch (e) {
      notify((e as Error).message);
    }
  }

  async function deleteScene() {
    if (await confirmDialog({ title: `Delete "${scene.name}"?`, message: 'This removes the scene and all of its tokens. This cannot be undone.', confirmLabel: 'Delete scene', danger: true })) {
      dispatch(sceneActions.remove.create({ id: scene.id }));
      useUi.getState().setViewedScene(null);
    }
  }

  const { grid } = scene;
  return (
    <>
      <section>
        <h3>Scene settings</h3>
        <TextField label="Name" value={scene.name} onCommit={(name) => update({ name })} />
        <div className="field-row">
          <NumberField label="Width (px)" value={scene.width} min={100} max={30000} onCommit={(width) => update({ width })} />
          <NumberField label="Height (px)" value={scene.height} min={100} max={30000} onCommit={(height) => update({ height })} />
        </div>
        <ColorField label="Background color" value={scene.backgroundColor} onCommit={(backgroundColor) => update({ backgroundColor })} />
        <div className="button-row">
          <ImageUploadButton label={scene.background ? 'Replace map image' : 'Upload map image'} onFile={setBackground} />
          {scene.background && (
            <button type="button" onClick={() => update({ background: null })}>
              Remove image
            </button>
          )}
        </div>
        <p className="muted small-text">Uploading a map resizes the scene to the image. Then match the grid size to the map's squares.</p>
      </section>
      <section>
        <h3>Grid</h3>
        <SelectField
          label="Type"
          value={grid.type}
          options={[
            { value: 'square', label: 'Square' },
            { value: 'none', label: 'None' },
          ]}
          onCommit={(type) => updateGrid({ type })}
        />
        <div className="field-row">
          <NumberField label="Cell size (px)" value={grid.size} min={8} max={500} onCommit={(size) => updateGrid({ size })} />
          <NumberField label="Offset X" value={grid.offsetX} min={-500} max={500} onCommit={(offsetX) => updateGrid({ offsetX })} />
          <NumberField label="Offset Y" value={grid.offsetY} min={-500} max={500} onCommit={(offsetY) => updateGrid({ offsetY })} />
        </div>
        <div className="field-row">
          <ColorField label="Line color" value={grid.color} onCommit={(color) => updateGrid({ color })} />
          <NumberField
            label="Opacity"
            value={grid.opacity}
            min={0}
            max={1}
            step={0.05}
            onCommit={(opacity) => updateGrid({ opacity })}
          />
        </div>
        <div className="field-row">
          <NumberField
            label="Units per cell"
            value={grid.unitsPerCell}
            min={0}
            onCommit={(unitsPerCell) => updateGrid({ unitsPerCell })}
          />
          <TextField label="Unit" value={grid.unitLabel} onCommit={(unitLabel) => updateGrid({ unitLabel })} />
        </div>
        <SelectField label="Diagonal measurement" value={grid.diagonals} options={DIAGONAL_OPTIONS} onCommit={(diagonals) => updateGrid({ diagonals })} />
        <CheckboxField label="Snap tokens to grid" value={grid.snap} onCommit={(snap) => updateGrid({ snap })} />
      </section>
      <section>
        <h3>Vision &amp; fog</h3>
        <CheckboxField
          label="Line of sight for players (walls block view)"
          value={scene.vision.enabled}
          onCommit={(enabled) => update({ vision: { ...scene.vision, enabled } })}
        />
        <CheckboxField
          label="Dark scene (needs light or darkvision)"
          value={scene.vision.dark}
          onCommit={(dark) => update({ vision: { ...scene.vision, dark } })}
        />
        <CheckboxField
          label="Fog of war"
          value={scene.fog.enabled}
          onCommit={(enabled) => dispatch(fogActions.setEnabled.create({ sceneId: scene.id, enabled }))}
        />
        <p className="muted small-text">
          Draw walls and doors with the ▤ tool, place lights with ☀, paint fog with ☁. Players can't move tokens through walls on
          any scene that has walls.
        </p>
      </section>
      <section>
        <button type="button" className="danger" onClick={deleteScene}>
          Delete scene
        </button>
      </section>
    </>
  );
}
