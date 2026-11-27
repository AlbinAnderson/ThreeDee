import { create } from 'zustand';
import { newId, wallActions, type GridSettings, type Point, type Wall } from '@vtt/shared';
import { confirmDialog } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { useCurrentScene } from '../state/hooks';
import { defineTool, type ToolContext } from './types';

type WallMode = 'wall' | 'door' | 'erase';

interface WallToolState {
  mode: WallMode;
  preview: Wall | null;
  set(changes: Partial<Omit<WallToolState, 'set'>>): void;
}

export const useWallTool = create<WallToolState>()((set) => ({
  mode: 'wall',
  preview: null,
  set: (changes) => set(changes),
}));

/** Snap to grid corners (where walls usually go). */
function snapVertex(p: Point, grid: GridSettings, free: boolean): Point {
  if (free || grid.type === 'none') return { x: Math.round(p.x), y: Math.round(p.y) };
  const s = grid.size;
  return {
    x: Math.round((p.x - grid.offsetX) / s) * s + grid.offsetX,
    y: Math.round((p.y - grid.offsetY) / s) * s + grid.offsetY,
  };
}

function distToSegment(p: Point, [x1, y1, x2, y2]: Wall['points']): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len2)) : 0;
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}

function eraseAt(p: Point, ctx: ToolContext, erased: Set<string>) {
  const tolerance = 12 / ctx.camera.zoom;
  const hits = Object.values(ctx.game.walls).filter(
    (w) => w.sceneId === ctx.scene.id && !erased.has(w.id) && distToSegment(p, w.points) < tolerance,
  );
  if (!hits.length) return;
  hits.forEach((w) => erased.add(w.id));
  ctx.dispatch(wallActions.remove.create({ ids: hits.map((w) => w.id) }));
}

/**
 * GM: draw walls and doors by dragging between grid corners (Alt = free
 * placement). Consecutive segments join up because they snap to the same
 * corners. Erase mode removes walls you drag across.
 */
export const wallTool = defineTool<{ start: Point | null; erased: Set<string> | null }>({
  id: 'walls',
  label: 'Walls & doors',
  icon: '▤',
  hotkey: 'w',
  gmOnly: true,
  cursor: 'crosshair',
  Options: WallOptions,
  createState: () => ({ start: null, erased: null }),

  onPointerDown(p, ctx, state) {
    const { mode } = useWallTool.getState();
    if (mode === 'erase') {
      state.erased = new Set();
      eraseAt(p.world, ctx, state.erased);
      return;
    }
    state.start = snapVertex(p.world, ctx.scene.grid, p.alt);
  },

  onPointerMove(p, ctx, state) {
    if (state.erased) return eraseAt(p.world, ctx, state.erased);
    if (!state.start) return;
    const end = snapVertex(p.world, ctx.scene.grid, p.alt);
    const { mode } = useWallTool.getState();
    useWallTool.getState().set({
      preview: { id: 'preview', sceneId: ctx.scene.id, points: [state.start.x, state.start.y, end.x, end.y], door: mode === 'door' ? 'closed' : null },
    });
  },

  onPointerUp(p, ctx, state) {
    state.erased = null;
    const start = state.start;
    state.start = null;
    useWallTool.getState().set({ preview: null });
    if (!start) return;
    const end = snapVertex(p.world, ctx.scene.grid, p.alt);
    if (Math.hypot(end.x - start.x, end.y - start.y) < 2) return;
    const { mode } = useWallTool.getState();
    ctx.dispatch(
      wallActions.add.create({
        walls: [{ id: newId(), sceneId: ctx.scene.id, points: [start.x, start.y, end.x, end.y], door: mode === 'door' ? 'closed' : null }],
      }),
    );
  },

  onCancel(_ctx, state) {
    state.start = null;
    state.erased = null;
    useWallTool.getState().set({ preview: null });
  },
});

function WallOptions() {
  const mode = useWallTool((s) => s.mode);
  const set = useWallTool((s) => s.set);
  const scene = useCurrentScene();
  return (
    <div className="tool-options">
      <div className="segmented">
        {(
          [
            ['wall', 'Wall'],
            ['door', 'Door'],
            ['erase', 'Erase'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" className={mode === m ? 'active' : ''} onClick={() => set({ mode: m })}>
            {label}
          </button>
        ))}
      </div>
      <span className="muted small-text">Drag between grid corners · Alt = free · Click a door's handle to open it</span>
      {scene && (
        <button
          type="button"
          className="small danger"
          onClick={async () => {
            if (await confirmDialog({ title: 'Clear all walls?', message: `Remove every wall and door on "${scene.name}"?`, confirmLabel: 'Clear walls', danger: true })) {
              dispatch(wallActions.clearScene.create({ sceneId: scene.id, lights: false }));
            }
          }}
        >
          Clear walls
        </button>
      )}
    </div>
  );
}
