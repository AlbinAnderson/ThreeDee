import { cellCenter } from '@vtt/shared';
import { defineTool } from './types';

/** Drag to measure. Snaps to cell centers on gridded scenes (hold Alt for free measuring). */
export const rulerTool = defineTool<{ active: boolean }>({
  id: 'ruler',
  label: 'Measure',
  icon: '📏',
  hotkey: 'r',
  cursor: 'crosshair',
  createState: () => ({ active: false }),

  onPointerDown(p, ctx, state) {
    state.active = true;
    const from = p.alt ? p.world : cellCenter(p.world, ctx.scene.grid);
    ctx.interaction.setRuler({ sceneId: ctx.scene.id, from, to: from });
  },

  onPointerMove(p, ctx, state) {
    const ruler = ctx.interaction.ruler;
    if (!state.active || !ruler) return;
    const to = p.alt ? p.world : cellCenter(p.world, ctx.scene.grid);
    ctx.interaction.setRuler({ ...ruler, to });
  },

  onPointerUp(_p, ctx, state) {
    state.active = false;
    ctx.interaction.setRuler(null);
  },

  onCancel(ctx, state) {
    state.active = false;
    ctx.interaction.setRuler(null);
  },
});
