import { create } from 'zustand';
import { fogActions, newId, type FogOp } from '@vtt/shared';
import { dispatch } from '../state/dispatch';
import { useCurrentScene } from '../state/hooks';
import { defineTool } from './types';

interface FogSettings {
  mode: FogOp['mode'];
  shape: 'rect' | 'ellipse' | 'brush';
  /** Brush diameter in grid cells. */
  brushCells: number;
  /** Stroke being painted (shown before it's committed). */
  preview: FogOp | null;
  set(changes: Partial<Omit<FogSettings, 'set'>>): void;
}

export const useFogTool = create<FogSettings>()((set) => ({
  mode: 'reveal',
  shape: 'rect',
  brushCells: 2,
  preview: null,
  set: (changes) => set(changes),
}));

const round = (n: number) => Math.round(n);

/** GM: paint fog of war. Reveal or hide with rectangles, ellipses or a brush. */
export const fogTool = defineTool<{ op: FogOp | null }>({
  id: 'fog',
  label: 'Fog of war',
  icon: '☁',
  hotkey: 'f',
  gmOnly: true,
  cursor: 'crosshair',
  Options: FogOptions,
  createState: () => ({ op: null }),

  onPointerDown(p, ctx, state) {
    const { mode, shape, brushCells } = useFogTool.getState();
    const x = round(p.world.x);
    const y = round(p.world.y);
    // Holding Alt temporarily flips reveal/hide.
    const effectiveMode = p.alt ? (mode === 'reveal' ? 'hide' : 'reveal') : mode;
    state.op = { id: newId(), mode: effectiveMode, shape, points: [x, y, x, y], width: brushCells * ctx.scene.grid.size };
    useFogTool.getState().set({ preview: state.op });
  },

  onPointerMove(p, ctx, state) {
    const op = state.op;
    if (!op) return;
    const x = round(p.world.x);
    const y = round(p.world.y);
    if (op.shape === 'brush') {
      const lx = op.points[op.points.length - 2]!;
      const ly = op.points[op.points.length - 1]!;
      if (Math.hypot(x - lx, y - ly) * ctx.camera.zoom < 4 || op.points.length >= 10000) return;
      state.op = { ...op, points: [...op.points, x, y] };
    } else {
      state.op = { ...op, points: [op.points[0]!, op.points[1]!, x, y] };
    }
    useFogTool.getState().set({ preview: state.op });
  },

  onPointerUp(_p, ctx, state) {
    const op = state.op;
    state.op = null;
    useFogTool.getState().set({ preview: null });
    if (!op) return;
    if (op.shape !== 'brush') {
      const [x0, y0, x1, y1] = op.points as [number, number, number, number];
      if (Math.abs(x1 - x0) < 2 || Math.abs(y1 - y0) < 2) return;
    }
    if (!ctx.scene.fog.enabled) dispatch(fogActions.setEnabled.create({ sceneId: ctx.scene.id, enabled: true }));
    ctx.dispatch(fogActions.add.create({ sceneId: ctx.scene.id, op }));
  },

  onCancel(_ctx, state) {
    state.op = null;
    useFogTool.getState().set({ preview: null });
  },
});

function FogOptions() {
  const settings = useFogTool();
  const scene = useCurrentScene();
  if (!scene) return null;
  const sceneId = scene.id;

  return (
    <div className="tool-options">
      <label className="inline-control">
        <input
          type="checkbox"
          checked={scene.fog.enabled}
          onChange={(e) => dispatch(fogActions.setEnabled.create({ sceneId, enabled: e.target.checked }))}
        />
        Fog on
      </label>
      <div className="segmented">
        {(['reveal', 'hide'] as const).map((m) => (
          <button key={m} type="button" className={settings.mode === m ? 'active' : ''} onClick={() => settings.set({ mode: m })}>
            {m === 'reveal' ? 'Reveal' : 'Hide'}
          </button>
        ))}
      </div>
      <div className="segmented">
        {(
          [
            ['rect', '▭', 'Rectangle'],
            ['ellipse', '◯', 'Ellipse'],
            ['brush', '🖌', 'Brush'],
          ] as const
        ).map(([shape, icon, title]) => (
          <button
            key={shape}
            type="button"
            title={title}
            className={settings.shape === shape ? 'active' : ''}
            onClick={() => settings.set({ shape })}
          >
            {icon}
          </button>
        ))}
      </div>
      {settings.shape === 'brush' && (
        <label className="inline-control" title="Brush size (cells)">
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={settings.brushCells}
            onChange={(e) => settings.set({ brushCells: Number(e.target.value) })}
          />
          <span>{settings.brushCells}</span>
        </label>
      )}
      <button type="button" className="small" onClick={() => dispatch(fogActions.undo.create({ sceneId }))} disabled={!scene.fog.ops.length}>
        Undo
      </button>
      <button
        type="button"
        className="small"
        onClick={() => dispatch(fogActions.reset.create({ sceneId, to: 'revealed', opId: newId() }))}
      >
        Reveal all
      </button>
      <button
        type="button"
        className="small"
        onClick={() => confirm('Cover the whole scene in fog again?') && dispatch(fogActions.reset.create({ sceneId, to: 'covered', opId: newId() }))}
      >
        Cover all
      </button>
      <span className="muted small-text">Alt flips reveal/hide</span>
    </div>
  );
}
