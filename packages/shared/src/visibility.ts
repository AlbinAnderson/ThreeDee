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

/** Distance along a ray (origin + t*dir) to segment s, or Infinity. */
function rayHit(ox: number, oy: number, dx: number, dy: number, s: Segment): number {
  const [x1, y1, x2, y2] = s;
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return Infinity;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
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
 */
export function visibilityPolygon(origin: Point, segments: Segment[], bounds: Bounds): Point[] {
  const { minX, minY, maxX, maxY } = bounds;
  const all: Segment[] = [
    ...segments,
    [minX, minY, maxX, minY],
    [maxX, minY, maxX, maxY],
    [maxX, maxY, minX, maxY],
    [minX, maxY, minX, minY],
  ];
  const angles: number[] = [];
  const seen = new Set<string>();
  for (const [x1, y1, x2, y2] of all) {
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ] as const) {
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = Math.atan2(y - origin.y, x - origin.x);
      angles.push(a - 1e-5, a, a + 1e-5);
    }
  }
  angles.sort((a, b) => a - b);

  const polygon: Point[] = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = Infinity;
    for (const s of all) {
      const t = rayHit(origin.x, origin.y, dx, dy, s);
      if (t < best) best = t;
    }
    if (best !== Infinity) polygon.push({ x: origin.x + dx * best, y: origin.y + dy * best });
  }
  return polygon;
}

export function polygonToSvgPoints(polygon: Point[]): string {
  return polygon.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(' ');
}
