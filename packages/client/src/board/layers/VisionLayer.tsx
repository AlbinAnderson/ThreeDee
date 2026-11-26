import { useMemo } from 'react';
import { blockingSegments, polygonToSvgPoints, visibilityPolygon, type Bounds, type Point, type Segment } from '@vtt/shared';
import { useGame, useIsGm, useSelf } from '../../state/hooks';
import { useInteraction } from '../interactionStore';
import type { LayerProps } from './types';

interface LightSource {
  id: string;
  x: number;
  y: number;
  bright: number;
  dim: number;
  poly: string;
}

/**
 * Players' line of sight. Everything is dark except what their tokens can see:
 * the area in line of sight, and (in dark scenes) only where it's lit or within
 * darkvision. Built as an SVG mask over a black sheet. The GM sees everything.
 */
export function VisionLayer({ scene }: LayerProps) {
  const gm = useIsGm();
  const self = useSelf();
  const tokens = useGame((s) => s.tokens);
  const walls = useGame((s) => s.walls);
  const lights = useGame((s) => s.lights);
  const preview = useInteraction((s) => s.dragPreview);
  const active = scene.vision.enabled && !gm;

  const computed = useMemo(() => {
    if (!active) return null;
    const cell = scene.grid.size;
    const segs: Segment[] = blockingSegments(Object.values(walls).filter((w) => w.sceneId === scene.id));
    const bounds: Bounds = { minX: -cell, minY: -cell, maxX: scene.width + cell, maxY: scene.height + cell };
    const center = (t: (typeof tokens)[string]): Point => {
      const pos = preview[t.id] ?? t;
      const half = (t.size * cell) / 2;
      return { x: pos.x + half, y: pos.y + half };
    };
    const sceneTokens = Object.values(tokens).filter((t) => t.sceneId === scene.id);
    const viewers = sceneTokens
      .filter((t) => t.ownerIds.includes(self.id))
      .map((t) => {
        const c = center(t);
        return { id: t.id, c, r: (t.size * cell) / 2, darkvision: t.darkvision * cell, poly: polygonToSvgPoints(visibilityPolygon(c, segs, bounds)) };
      });

    const sources: LightSource[] = [];
    if (scene.vision.dark) {
      for (const l of Object.values(lights)) {
        if (l.sceneId !== scene.id) continue;
        sources.push({ id: l.id, x: l.x, y: l.y, bright: l.bright * cell, dim: Math.max(l.dim, l.bright) * cell, poly: polygonToSvgPoints(visibilityPolygon(l, segs, bounds)) });
      }
      for (const t of sceneTokens) {
        if (!t.light || t.hidden) continue;
        const c = center(t);
        sources.push({ id: `t-${t.id}`, ...c, bright: t.light.bright * cell, dim: Math.max(t.light.dim, t.light.bright) * cell, poly: polygonToSvgPoints(visibilityPolygon(c, segs, bounds)) });
      }
    }
    return { viewers, sources };
  }, [active, scene, walls, lights, tokens, preview, self.id]);

  if (!computed) return null;
  const { viewers, sources } = computed;
  const id = `vision-${scene.id}`;
  const pad = Math.max(scene.width, scene.height);
  const big = { x: -pad, y: -pad, width: scene.width + 2 * pad, height: scene.height + 2 * pad };

  return (
    <g className="layer-vision" pointerEvents="none">
      <defs>
        {viewers.map((v) => (
          <clipPath key={v.id} id={`${id}-los-${v.id}`}>
            <polygon points={v.poly} />
          </clipPath>
        ))}
        {sources.map((s) => (
          <clipPath key={s.id} id={`${id}-light-${s.id}`}>
            <polygon points={s.poly} />
          </clipPath>
        ))}
        {/* white = darkness shown, black = see-through */}
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" {...big}>
          <rect {...big} fill="white" />
          {viewers.map((v) => (
            <g key={v.id} clipPath={`url(#${id}-los-${v.id})`}>
              {!scene.vision.dark ? (
                <rect {...big} fill="black" />
              ) : (
                <>
                  {sources.map((s) => (
                    <g key={s.id} clipPath={`url(#${id}-light-${s.id})`}>
                      <circle cx={s.x} cy={s.y} r={s.dim} fill="#555" />
                      <circle cx={s.x} cy={s.y} r={s.bright} fill="black" />
                    </g>
                  ))}
                  {v.darkvision > 0 && <circle cx={v.c.x} cy={v.c.y} r={v.darkvision + v.r} fill="black" />}
                </>
              )}
            </g>
          ))}
          {/* You can always see your own tokens. */}
          {viewers.map((v) => (
            <circle key={`self-${v.id}`} cx={v.c.x} cy={v.c.y} r={v.r} fill="black" />
          ))}
        </mask>
      </defs>
      <rect {...big} fill="#050506" mask={`url(#${id}-mask)`} />
      {viewers.length === 0 && (
        <text x={scene.width / 2} y={scene.height / 2} className="vision-hint">
          You have no token on this scene, so you can't see anything.
        </text>
      )}
    </g>
  );
}
