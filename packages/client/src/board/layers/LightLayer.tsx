import { useMemo } from 'react';
import { useGame, useIsGm } from '../../state/hooks';
import { useUi } from '../../state/uiStore';
import type { LayerProps } from './types';

/** GM-only markers for placed lights, with their bright/dim radii. */
export function LightLayer({ scene }: LayerProps) {
  const gm = useIsGm();
  const lights = useGame((s) => s.lights);
  const zoom = useUi((s) => s.camera.zoom);
  const editing = useUi((s) => s.toolId === 'light' || s.toolId === 'walls');
  const list = useMemo(() => Object.values(lights).filter((l) => l.sceneId === scene.id), [lights, scene.id]);
  if (!gm || !list.length) return null;
  const cell = scene.grid.size;
  const k = 1 / zoom;
  return (
    <g className="layer-lights" pointerEvents="none">
      {list.map((l) => (
        <g key={l.id}>
          {editing && (
            <>
              <circle cx={l.x} cy={l.y} r={Math.max(l.dim, l.bright) * cell} fill="none" stroke={l.color} strokeOpacity={0.5} strokeDasharray={`${6 * k} ${6 * k}`} strokeWidth={2 * k} />
              <circle cx={l.x} cy={l.y} r={l.bright * cell} fill={l.color} fillOpacity={0.08} stroke={l.color} strokeOpacity={0.7} strokeWidth={2 * k} />
            </>
          )}
          <g transform={`translate(${l.x} ${l.y}) scale(${k})`}>
            <circle r={9} fill="#16171a" stroke={l.color} strokeWidth={2} />
            <text className="door-glyph" fill={l.color}>
              ☀
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}
