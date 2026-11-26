import { cellCenter, type Point } from '@vtt/shared';
import { clearSharedRuler, setSharedRuler } from '../board/rulerShare';
import { defineTool } from './types';

/**
 * Drag to measure; everyone at the table sees your ruler. Snaps to cell
 * centers on gridded scenes (hold Alt for free measuring).
 */
export const rulerTool = defineTool<{ from: Point | null }>({
  id: 'ruler',
  label: 'Measure',
  icon: '📏',
  hotkey: 'r',
  cursor: 'crosshair',
  createState: () => ({ from: null }),

  onPointerDown(p, ctx, state) {
    state.from = p.alt ? p.world : cellCenter(p.world, ctx.scene.grid);
    setSharedRuler(ctx.scene.id, state.from, state.from);
  },

  onPointerMove(p, ctx, state) {
    if (!state.from) return;
    setSharedRuler(ctx.scene.id, state.from, p.alt ? p.world : cellCenter(p.world, ctx.scene.grid));
  },

  onPointerUp(_p, ctx, state) {
    state.from = null;
    clearSharedRuler(ctx.scene.id);
  },

  onCancel(ctx, state) {
    if (!state.from) return;
    state.from = null;
    clearSharedRuler(ctx.scene.id);
  },
});
