import { measureDistance } from '@vtt/shared';
import { useUi } from '../../state/uiStore';
import { useInteraction } from '../interactionStore';
import type { LayerProps } from './types';

export function RulerLayer({ scene }: LayerProps) {
  const ruler = useInteraction((s) => s.ruler);
  const zoom = useUi((s) => s.camera.zoom);
  if (!ruler || ruler.sceneId !== scene.id) return null;

  const { from, to } = ruler;
  const { distance, cells } = measureDistance(from, to, scene.grid);
  const rounded = Math.round(distance * 10) / 10;
  const label = scene.grid.unitsPerCell ? `${rounded} ${scene.grid.unitLabel}` : `${Math.round(cells * 10) / 10} sq`;
  const k = 1 / zoom; // keep the overlay a constant size on screen

  return (
    <g className="layer-ruler" pointerEvents="none">
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="ruler-line" strokeWidth={4 * k} />
      <circle cx={from.x} cy={from.y} r={5 * k} className="ruler-end" />
      <circle cx={to.x} cy={to.y} r={5 * k} className="ruler-end" />
      <g transform={`translate(${to.x} ${to.y}) scale(${k})`}>
        <rect x={12} y={-30} width={label.length * 9 + 16} height={26} rx={6} className="ruler-label-bg" />
        <text x={20} y={-12} className="ruler-label">
          {label}
        </text>
      </g>
    </g>
  );
}
