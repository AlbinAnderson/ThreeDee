import { canDeleteDrawing, canDeleteTemplate, drawingActions, templateActions } from '@vtt/shared';
import type { BoardPointer, ToolContext } from './types';
import { defineTool } from './types';

function eraseAt(p: BoardPointer, ctx: ToolContext, erased: Set<string>) {
  const tid = p.templateId;
  if (tid && !erased.has(tid)) {
    const t = ctx.game.templates[tid];
    if (t && canDeleteTemplate(ctx.self, t)) {
      erased.add(tid);
      ctx.dispatch(templateActions.remove.create({ id: tid }));
    }
    return;
  }
  const id = p.drawingId;
  if (!id || erased.has(id)) return;
  const drawing = ctx.game.drawings[id];
  if (!drawing || !canDeleteDrawing(ctx.self, drawing)) return;
  erased.add(id);
  ctx.dispatch(drawingActions.remove.create({ id }));
}

/** Click or drag across drawings and templates to erase them (your own; the GM can erase any). */
export const eraseTool = defineTool<{ erased: Set<string> | null }>({
  id: 'erase',
  label: 'Erase drawings',
  icon: '⌫',
  hotkey: 'e',
  cursor: 'cell',
  createState: () => ({ erased: null }),

  onPointerDown(p, ctx, state) {
    state.erased = new Set();
    eraseAt(p, ctx, state.erased);
  },
  onPointerMove(p, ctx, state) {
    if (state.erased) eraseAt(p, ctx, state.erased);
  },
  onPointerUp(_p, _ctx, state) {
    state.erased = null;
  },
  onCancel(_ctx, state) {
    state.erased = null;
  },
});
