import { fitCamera } from '../board/Board';
import { useCurrentScene, useIsGm } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { tools } from '../tools';

export function Toolbar() {
  const gm = useIsGm();
  const toolId = useUi((s) => s.toolId);
  const setTool = useUi((s) => s.setTool);
  const zoom = useUi((s) => s.camera.zoom);
  const scene = useCurrentScene();
  const Options = tools.find((t) => t.id === toolId)?.Options;

  function zoomBy(factor: number) {
    const { camera, viewport, setCamera } = useUi.getState();
    const z = Math.min(6, Math.max(0.1, camera.zoom * factor));
    const f = z / camera.zoom;
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    setCamera({ zoom: z, x: cx - (cx - camera.x) * f, y: cy - (cy - camera.y) * f });
  }

  return (
    <div className="toolbar-wrap">
    <div className="toolbar">
      {tools
        .filter((t) => gm || !t.gmOnly)
        .map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === toolId ? 'active' : ''}
            title={`${t.label}${t.hotkey ? ` (${t.hotkey.toUpperCase()})` : ''}`}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
      <span className="toolbar-sep" />
      <button type="button" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
        −
      </button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <button type="button" title="Zoom in" onClick={() => zoomBy(1.25)}>
        +
      </button>
      <button
        type="button"
        title="Fit scene to screen"
        disabled={!scene}
        onClick={() => scene && useUi.getState().setCamera(fitCamera(scene, useUi.getState().viewport))}
      >
        ⤢
      </button>
    </div>
    {Options && <Options />}
    </div>
  );
}
