/**
 * Line-of-sight geometry: wall blocking and visibility polygons (raycast to
 * every wall endpoint). Pure functions shared by client and server.
 */
import type { Point } from './geometry';
import type { Wall } from './state';

export type Segment = readonly [number, number, number, number];

/** Walls that currently block sight and movement (open doors don't). */
export function blockingSegments(walls: Iterable<Wall>): Segment[] {
  const out: Segment[] = [];
  for (const w of walls) if (w.door !== 'open') out.push(w.points);
  return out;
}

/** Whether segment a-b crosses segment s (touching endpoints counts). */
export function segmentsIntersect(a: Point, b: Point, s: Segment): boolean {
  const [x3, y3, x4, y4] = s;
  const d = (b.x - a.x) * (y4 - y3) - (b.y - a.y) * (x4 - x3);
  if (d === 0) return false; // parallel
  const t = ((x3 - a.x) * (y4 - y3) - (y3 - a.y) * (x4 - x3)) / d;
  const u = ((x3 - a.x) * (b.y - a.y) - (y3 - a.y) * (b.x - a.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Whether moving in a straight line from a to b passes through a blocking wall. */
export function isPathBlocked(a: Point, b: Point, segments: Segment[]): boolean {
  return segments.some((s) => segmentsIntersect(a, b, s));
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Polygon of everything visible from `origin`, bounded by `bounds`.
 * Casts rays at every wall endpoint (and slightly to either side) and keeps
 * the nearest hit, which yields the exact visibility polygon.
 *
 * Optimizations:
 *  - Culls segments whose AABB does not intersect `bounds` (huge win for bounded light radii).
 *  - Packs segments into flat Float64Arrays and precomputes `cross = (x1-ox)*sy - (y1-oy)*sx`
 *    once per segment so the inner O(W^2) ray test rejects `t < 0 || t >= best` before computing `u`.
 */
export function visibilityPolygon(origin: Point, segments: Segment[], bounds: Bounds): Point[] {
  const { minX, minY, maxX, maxY } = bounds;
  const ox = origin.x;
  const oy = origin.y;

  // Cull segments completely outside `bounds`, then append the 4 bounding box edges.
  const all: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const x1 = s[0];
    const y1 = s[1];
    const x2 = s[2];
    const y2 = s[3];
    if ((x1 < minX && x2 < minX) || (x1 > maxX && x2 > maxX) || (y1 < minY && y2 < minY) || (y1 > maxY && y2 > maxY)) {
      continue;
    }
    all.push(s);
  }
  all.push([minX, minY, maxX, minY], [maxX, minY, maxX, maxY], [maxX, maxY, minX, maxY], [minX, maxY, minX, minY]);

  const n = all.length;
  const segRx = new Float64Array(n);
  const segRy = new Float64Array(n);
  const segSx = new Float64Array(n);
  const segSy = new Float64Array(n);
  const segCross = new Float64Array(n);

  const angles: number[] = [];
  const seen = new Map<number, number[]>();
  const addEndpoint = (x: number, y: number) => {
    let ys = seen.get(x);
    if (ys) {
      for (let i = 0; i < ys.length; i++) if (ys[i] === y) return;
      ys.push(y);
    } else {
      seen.set(x, [y]);
    }
    const a = Math.atan2(y - oy, x - ox);
    angles.push(a - 1e-5, a, a + 1e-5);
  };

  for (let i = 0; i < n; i++) {
    const s = all[i]!;
    const x1 = s[0];
    const y1 = s[1];
    const x2 = s[2];
    const y2 = s[3];
    const rx = x1 - ox;
    const ry = y1 - oy;
    const sx = x2 - x1;
    const sy = y2 - y1;
    segRx[i] = rx;
    segRy[i] = ry;
    segSx[i] = sx;
    segSy[i] = sy;
    segCross[i] = rx * sy - ry * sx;
    addEndpoint(x1, y1);
    addEndpoint(x2, y2);
  }
  angles.sort((a, b) => a - b);

  const polygon: Point[] = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      const denom = dx * segSy[j]! - dy * segSx[j]!;
      if (denom > -1e-12 && denom < 1e-12) continue;
      const t = segCross[j]! / denom;
      if (t < 0 || t >= best) continue;
      const u = (segRx[j]! * dy - segRy[j]! * dx) / denom;
      if (u >= -1e-9 && u <= 1 + 1e-9) best = t;
    }
    if (best !== Infinity) polygon.push({ x: ox + dx * best, y: oy + dy * best });
  }
  return polygon;
}

export function polygonToSvgPoints(polygon: Point[]): string {
  return polygon.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(' ');
}
