import type { GridSettings } from './state';

export interface Point {
  x: number;
  y: number;
}

function gridActive(grid: GridSettings) {
  return grid.type !== 'none';
}

/** Snap a token's top-left corner onto grid lines. */
export function snapTokenPosition(p: Point, grid: GridSettings): Point {
  if (!gridActive(grid) || !grid.snap) return p;
  const s = grid.size;
  return {
    x: Math.round((p.x - grid.offsetX) / s) * s + grid.offsetX,
    y: Math.round((p.y - grid.offsetY) / s) * s + grid.offsetY,
  };
}

/** Center of the grid cell containing `p`. */
export function cellCenter(p: Point, grid: GridSettings): Point {
  if (!gridActive(grid)) return p;
  const s = grid.size;
  return {
    x: (Math.floor((p.x - grid.offsetX) / s) + 0.5) * s + grid.offsetX,
    y: (Math.floor((p.y - grid.offsetY) / s) + 0.5) * s + grid.offsetY,
  };
}

/** Distance between two points, counted in cells according to the grid's diagonal rule. */
export function measureDistance(a: Point, b: Point, grid: GridSettings): { cells: number; distance: number } {
  const s = grid.size;
  let cells: number;
  if (!gridActive(grid) || grid.diagonals === 'euclidean') {
    cells = Math.hypot(b.x - a.x, b.y - a.y) / s;
  } else {
    const dx = Math.abs(Math.round((b.x - a.x) / s));
    const dy = Math.abs(Math.round((b.y - a.y) / s));
    const long = Math.max(dx, dy);
    const short = Math.min(dx, dy);
    switch (grid.diagonals) {
      case 'chebyshev':
        cells = long;
        break;
      case 'manhattan':
        cells = dx + dy;
        break;
      case 'alternating':
        cells = long + Math.floor(short / 2);
        break;
    }
  }
  return { cells, distance: cells * grid.unitsPerCell };
}
