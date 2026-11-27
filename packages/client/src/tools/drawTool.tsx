import { DRAWING_MAX_COORDS, drawingActions, newId, type Drawing, type DrawingShape } from '@vtt/shared';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useCurrentScene, useIsGm, useSelf } from '../state/hooks';
import { useUi } from '../state/uiStore';
import { defineTool } from './types';

const round = (n: number) => Math.round(n * 10) / 10;

/** Freehand pen and simple shapes. Settings live in uiStore.draw. */
export const drawTool = defineTool<{ drawing: Drawing | null }>({
  id: 'draw',
  label: 'Draw',
  icon: '✎',
  hotkey: 'd',
  cursor: 'crosshair',
  Options: DrawOptions,
  createState: () => ({ drawing: null }),

  onPointerDown(p, ctx, state) {
    const { shape, color, width, fill } = ctx.ui.draw;
    const x = round(p.world.x);
    const y = round(p.world.y);
    state.drawing = {
      id: newId(),
      sceneId: ctx.scene.id,
      authorId: ctx.self.id,
      shape,
      points: [x, y, x, y],
      color,
      width,
      fill: shape !== 'freehand' && shape !== 'line' && fill,
    };
    ctx.interaction.setDrawPreview(state.drawing);
  },

  onPointerMove(p, ctx, state) {
    const d = state.drawing;
    if (!d) return;
    const x = round(p.world.x);
    const y = round(p.world.y);
    let points: number[];
    if (d.shape === 'freehand') {
      const lx = d.points[d.points.length - 2]!;
      const ly = d.points[d.points.length - 1]!;
      // Skip points closer than ~2 screen pixels, and stop at the size cap.
      if (Math.hypot(x - lx, y - ly) * ctx.camera.zoom < 2 || d.points.length >= DRAWING_MAX_COORDS) return;
      points = [...d.points, x, y];
    } else {
      points = [d.points[0]!, d.points[1]!, x, y];
    }
    state.drawing = { ...d, points };
    ctx.interaction.setDrawPreview(state.drawing);
  },

  onPointerUp(_p, ctx, state) {
    const d = state.drawing;
    state.drawing = null;
    ctx.interaction.setDrawPreview(null);
    if (!d) return;
    if (d.shape !== 'freehand') {
      const [x0, y0, x1, y1] = d.points as [number, number, number, number];
      if (Math.hypot(x1 - x0, y1 - y0) * ctx.camera.zoom < 3) return; // accidental click
    }
    ctx.dispatch(drawingActions.create.create({ drawing: d }));
  },

  onCancel(ctx, state) {
    state.drawing = null;
    ctx.interaction.setDrawPreview(null);
  },
});

const SHAPES: { value: DrawingShape; label: string; icon: string }[] = [
  { value: 'freehand', label: 'Pen', icon: '✎' },
  { value: 'line', label: 'Line', icon: '╱' },
  { value: 'rect', label: 'Rectangle', icon: '▭' },
  { value: 'ellipse', label: 'Ellipse', icon: '◯' },
];

const SWATCHES = ['#ff4d4d', '#ffd400', '#3fb950', '#4dabff', '#c77dff', '#ffffff', '#111111'];

function DrawOptions() {
  const draw = useUi((s) => s.draw);
  const setDraw = useUi((s) => s.setDraw);
  const scene = useCurrentScene();
  const self = useSelf();
  const gm = useIsGm();

  return (
    <div className="tool-options">
      <div className="segmented">
        {SHAPES.map((s) => (
          <button
            key={s.value}
            type="button"
            title={s.label}
            className={draw.shape === s.value ? 'active' : ''}
            onClick={() => setDraw({ shape: s.value })}
          >
            {s.icon}
          </button>
        ))}
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch-button${draw.color === c ? ' active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => setDraw({ color: c })}
          />
        ))}
        <input type="color" value={draw.color} title="Custom color" onChange={(e) => setDraw({ color: e.target.value })} />
      </div>
      <label className="inline-control" title="Stroke width">
        <input
          type="range"
          min={1}
          max={40}
          value={draw.width}
          onChange={(e) => setDraw({ width: Number(e.target.value) })}
        />
        <span>{draw.width}</span>
      </label>
      {(draw.shape === 'rect' || draw.shape === 'ellipse') && (
        <label className="inline-control">
          <input type="checkbox" checked={draw.fill} onChange={(e) => setDraw({ fill: e.target.checked })} />
          Fill
        </label>
      )}
      {scene && (
        <>
          <button
            type="button"
            className="small"
            onClick={() => dispatch(drawingActions.clear.create({ sceneId: scene.id, authorId: self.id }))}
          >
            Clear mine
          </button>
          {gm && (
            <button
              type="button"
              className="small danger"
              onClick={async () => {
                if (await confirmDialog({ title: 'Erase all drawings?', message: `Erase every drawing on "${scene.name}"?`, confirmLabel: 'Erase all', danger: true })) {
                  dispatch(drawingActions.clear.create({ sceneId: scene.id }));
                }
              }}
            >
              Clear all
            </button>
          )}
        </>
      )}
    </div>
  );
}
