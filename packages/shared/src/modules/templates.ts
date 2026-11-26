/** Area-of-effect templates (bursts, cones, lines, squares). */
import { z } from 'zod';
import { defineAction } from '../actions/define';
import { isGm } from '../actions/auth';
import type { Point } from '../geometry';
import { IdSchema, TemplateSchema, type GridSettings, type Template, type User } from '../state';

export function canDeleteTemplate(user: User, t: Template) {
  return isGm(user) || t.authorId === user.id;
}

const EPS = 1e-6;

/** Whether a point (usually a cell center) is inside the template. */
export function templateContains(t: Template, p: Point, cellSize: number): boolean {
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const size = t.size * cellSize;
  switch (t.kind) {
    case 'circle':
      return Math.hypot(dx, dy) <= size + EPS;
    case 'square':
      return Math.abs(dx) <= size + EPS && Math.abs(dy) <= size + EPS;
    case 'cone': {
      if (Math.hypot(dx, dy) > size + EPS) return false;
      let diff = Math.atan2(dy, dx) - t.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // wrap to [-pi, pi]
      return Math.abs(diff) <= (t.coneAngle * Math.PI) / 360 + EPS;
    }
    case 'line': {
      const ux = Math.cos(t.angle);
      const uy = Math.sin(t.angle);
      const along = dx * ux + dy * uy;
      const across = Math.abs(-dx * uy + dy * ux);
      return along >= -EPS && along <= size + EPS && across <= (t.width * cellSize) / 2 + EPS;
    }
  }
}

/** Top-left corners of the grid cells whose centers fall inside the template. */
export function templateCells(t: Template, grid: GridSettings): Point[] {
  if (grid.type === 'none') return [];
  const s = grid.size;
  const reach = (Math.max(t.size, t.width) + 1) * s;
  const cells: Point[] = [];
  const minCol = Math.floor((t.x - reach - grid.offsetX) / s);
  const maxCol = Math.ceil((t.x + reach - grid.offsetX) / s);
  const minRow = Math.floor((t.y - reach - grid.offsetY) / s);
  const maxRow = Math.ceil((t.y + reach - grid.offsetY) / s);
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      const x = c * s + grid.offsetX;
      const y = r * s + grid.offsetY;
      if (templateContains(t, { x: x + s / 2, y: y + s / 2 }, s)) cells.push({ x, y });
    }
  }
  return cells;
}

export const templateActions = {
  create: defineAction('template/create', z.object({ template: TemplateSchema }), {
    authorize(ctx, { template }) {
      if (template.authorId !== ctx.user.id) return 'Templates must be placed by yourself';
      if (!ctx.state.scenes[template.sceneId]) return 'Scene not found';
      if (!isGm(ctx.user) && template.sceneId !== ctx.state.activeSceneId) return 'Players can only place templates on the active scene';
      return true;
    },
    apply(draft, { template }) {
      if (draft.scenes[template.sceneId] && !draft.templates[template.id]) draft.templates[template.id] = template;
    },
  }),

  remove: defineAction('template/delete', z.object({ id: IdSchema }), {
    authorize(ctx, { id }) {
      const t = ctx.state.templates[id];
      if (!t) return 'Template not found';
      return canDeleteTemplate(ctx.user, t) || 'You can only remove your own templates';
    },
    apply(draft, { id }) {
      delete draft.templates[id];
    },
  }),
};
