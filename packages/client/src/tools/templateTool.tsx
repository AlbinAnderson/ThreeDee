import { create } from 'zustand';
import { newId, templateActions, type GridSettings, type Point, type Template, type TemplateKind } from '@vtt/shared';
import { useCurrentScene } from '../state/hooks';
import { defineTool } from './types';

interface TemplateToolState {
  kind: TemplateKind;
  coneAngle: number;
  /** Line width in cells. */
  width: number;
  color: string;
  preview: Template | null;
  set(changes: Partial<Omit<TemplateToolState, 'set'>>): void;
}

export const useTemplateTool = create<TemplateToolState>()((set) => ({
  kind: 'circle',
  coneAngle: 90,
  width: 1,
  color: '#ff8c42',
  preview: null,
  set: (changes) => set(changes),
}));

/** Templates originate on grid intersections (PF1e/3.5 style); Alt = free. */
function snapOrigin(p: Point, grid: GridSettings, free: boolean): Point {
  if (free || grid.type === 'none') return p;
  const s = grid.size;
  return { x: Math.round((p.x - grid.offsetX) / s) * s + grid.offsetX, y: Math.round((p.y - grid.offsetY) / s) * s + grid.offsetY };
}

/** Drag from the origin: distance sets the size (whole cells), direction aims cones/lines. */
function build(origin: Point, to: Point, grid: GridSettings, sceneId: string, authorId: string, id: string): Template {
  const { kind, coneAngle, width, color } = useTemplateTool.getState();
  const dist = Math.hypot(to.x - origin.x, to.y - origin.y) / grid.size;
  return {
    id,
    sceneId,
    authorId,
    kind,
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    size: Math.max(0.5, Math.round(dist)),
    angle: Math.atan2(to.y - origin.y, to.x - origin.x),
    coneAngle,
    width,
    color,
  };
}

export const templateTool = defineTool<{ origin: Point | null; id: string }>({
  id: 'template',
  label: 'Area template',
  icon: '◭',
  hotkey: 't',
  cursor: 'crosshair',
  Options: TemplateOptions,
  createState: () => ({ origin: null, id: '' }),

  onPointerDown(p, ctx, state) {
    state.origin = snapOrigin(p.world, ctx.scene.grid, p.alt);
    state.id = newId();
    useTemplateTool.getState().set({ preview: build(state.origin, state.origin, ctx.scene.grid, ctx.scene.id, ctx.self.id, state.id) });
  },

  onPointerMove(p, ctx, state) {
    if (!state.origin) return;
    useTemplateTool.getState().set({ preview: build(state.origin, p.world, ctx.scene.grid, ctx.scene.id, ctx.self.id, state.id) });
  },

  onPointerUp(p, ctx, state) {
    const origin = state.origin;
    state.origin = null;
    useTemplateTool.getState().set({ preview: null });
    if (!origin) return;
    if (Math.hypot(p.world.x - origin.x, p.world.y - origin.y) < ctx.scene.grid.size * 0.4) return;
    ctx.dispatch(templateActions.create.create({ template: build(origin, p.world, ctx.scene.grid, ctx.scene.id, ctx.self.id, state.id) }));
  },

  onCancel(_ctx, state) {
    state.origin = null;
    useTemplateTool.getState().set({ preview: null });
  },
});

const KINDS: [TemplateKind, string, string][] = [
  ['circle', '◯', 'Burst / spread (radius)'],
  ['cone', '◭', 'Cone'],
  ['line', '━', 'Line'],
  ['square', '▢', 'Square (half-side)'],
];

function TemplateOptions() {
  const s = useTemplateTool();
  const scene = useCurrentScene();
  const unit = scene?.grid.unitsPerCell ? `${scene.grid.unitsPerCell} ${scene.grid.unitLabel}` : '1 cell';
  return (
    <div className="tool-options">
      <div className="segmented">
        {KINDS.map(([kind, icon, title]) => (
          <button key={kind} type="button" title={title} className={s.kind === kind ? 'active' : ''} onClick={() => s.set({ kind })}>
            {icon}
          </button>
        ))}
      </div>
      {s.kind === 'cone' && (
        <select value={s.coneAngle} onChange={(e) => s.set({ coneAngle: Number(e.target.value) })} title="Cone angle">
          <option value={90}>90° (PF1e / 3.5)</option>
          <option value={53.13}>53° (5e)</option>
          <option value={60}>60°</option>
        </select>
      )}
      {s.kind === 'line' && (
        <label className="inline-control" title="Line width (cells)">
          Width
          <input type="number" min={0.5} max={20} step={0.5} value={s.width} onChange={(e) => s.set({ width: Math.max(0.5, Number(e.target.value) || 1) })} />
        </label>
      )}
      <input type="color" value={s.color} onChange={(e) => s.set({ color: e.target.value })} title="Color" />
      <span className="muted small-text">Drag from a grid corner · 1 cell = {unit} · Alt = free · Erase with ⌫</span>
    </div>
  );
}
