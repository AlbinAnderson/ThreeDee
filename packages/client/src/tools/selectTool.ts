import { canControlToken, snapTokenPosition, tokenActions, type Point } from '@vtt/shared';
import { clearSharedRuler, setSharedRuler } from '../board/rulerShare';
import { defineTool } from './types';

interface DragState {
  start: Point;
  origins: Record<string, Point>;
  moved: boolean;
  /** Token under the pointer; its movement is measured and shown to everyone. */
  leadId: string;
}

/** Click to select (shift to add), drag to move. Dragging empty space pans. Hold Alt to drop without snapping. */
export const selectTool = defineTool<{ drag: DragState | null }>({
  id: 'select',
  label: 'Select / Move',
  icon: '➤',
  hotkey: 'v',
  createState: () => ({ drag: null }),

  onPointerDown(p, ctx, state) {
    if (!p.tokenId) {
      if (!p.shift) ctx.ui.clearSelection();
      return 'pan';
    }
    const id = p.tokenId;
    const current = ctx.ui.selectedTokenIds;
    let next: string[];
    if (p.shift) next = current.includes(id) ? current.filter((t) => t !== id) : [...current, id];
    else next = current.includes(id) ? current : [id];
    ctx.ui.setSelection(next);
    if (!next.includes(id)) return;

    const origins: Record<string, Point> = {};
    for (const tid of next) {
      const token = ctx.game.tokens[tid];
      if (token && token.sceneId === ctx.scene.id && canControlToken(ctx.self, token)) {
        origins[tid] = { x: token.x, y: token.y };
      }
    }
    if (origins[id]) state.drag = { start: p.world, origins, moved: false, leadId: id };
  },

  onPointerMove(p, ctx, state) {
    const drag = state.drag;
    if (!drag) return;
    const dx = p.world.x - drag.start.x;
    const dy = p.world.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * ctx.camera.zoom < 3) return;
    drag.moved = true;
    const preview: Record<string, Point> = {};
    for (const [id, o] of Object.entries(drag.origins)) preview[id] = { x: o.x + dx, y: o.y + dy };
    ctx.interaction.setDragPreview(preview);

    // Show how far the lead token is moving (center to where it will land).
    const lead = ctx.game.tokens[drag.leadId];
    const origin = drag.origins[drag.leadId];
    if (lead && origin) {
      const half = (lead.size * ctx.scene.grid.size) / 2;
      const landing = p.alt ? preview[drag.leadId]! : snapTokenPosition(preview[drag.leadId]!, ctx.scene.grid);
      setSharedRuler(ctx.scene.id, { x: origin.x + half, y: origin.y + half }, { x: landing.x + half, y: landing.y + half });
    }
  },

  onPointerUp(p, ctx, state) {
    const drag = state.drag;
    state.drag = null;
    if (!drag?.moved) return;
    clearSharedRuler(ctx.scene.id);
    const dx = p.world.x - drag.start.x;
    const dy = p.world.y - drag.start.y;
    for (const [id, o] of Object.entries(drag.origins)) {
      const raw = { x: o.x + dx, y: o.y + dy };
      const pos = p.alt ? raw : snapTokenPosition(raw, ctx.scene.grid);
      ctx.dispatch(tokenActions.move.create({ id, x: Math.round(pos.x), y: Math.round(pos.y) }));
    }
    ctx.interaction.setDragPreview({});
  },

  onCancel(ctx, state) {
    if (state.drag?.moved) clearSharedRuler(ctx.scene.id);
    state.drag = null;
    ctx.interaction.setDragPreview({});
  },
});
