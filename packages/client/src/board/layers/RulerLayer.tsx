import { useEffect } from 'react';
import { measureDistance, type Point, type Scene } from '@vtt/shared';
import { onEphemeral } from '../../net/ephemeral';
import { useGameStore } from '../../state/gameStore';
import { useSelf } from '../../state/hooks';
import { useUi } from '../../state/uiStore';
import { useInteraction } from '../interactionStore';
import type { LayerProps } from './types';

export function RulerLayer({ scene }: LayerProps) {
  const ruler = useInteraction((s) => s.ruler);
  const remote = useInteraction((s) => s.remoteRulers);
  const zoom = useUi((s) => s.camera.zoom);
  const self = useSelf();

  useEffect(
    () =>
      onEphemeral('ruler', (from, e) => {
        const { setRemoteRuler } = useInteraction.getState();
        if (!e.points) return setRemoteRuler(from, null);
        const color = useGameStore.getState().view?.users[from]?.color ?? '#ffffff';
        const [x1, y1, x2, y2] = e.points;
        setRemoteRuler(from, { sceneId: e.sceneId, from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, color, at: Date.now() });
      }),
    [],
  );

  return (
    <g className="layer-ruler" pointerEvents="none">
      {Object.entries(remote)
        .filter(([, r]) => r.sceneId === scene.id)
        .map(([userId, r]) => (
          <RulerView key={userId} scene={scene} from={r.from} to={r.to} color={r.color} zoom={zoom} />
        ))}
      {ruler && ruler.sceneId === scene.id && (
        <RulerView scene={scene} from={ruler.from} to={ruler.to} color={self.color} zoom={zoom} />
      )}
    </g>
  );
}

function RulerView({ scene, from, to, color, zoom }: { scene: Scene; from: Point; to: Point; color: string; zoom: number }) {
  const { distance, cells } = measureDistance(from, to, scene.grid);
  const label = scene.grid.unitsPerCell
    ? `${Math.round(distance * 10) / 10} ${scene.grid.unitLabel}`
    : `${Math.round(cells * 10) / 10} sq`;
  const k = 1 / zoom; // keep the overlay a constant size on screen
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="ruler-line" stroke={color} strokeWidth={4 * k} />
      <circle cx={from.x} cy={from.y} r={5 * k} fill={color} />
      <circle cx={to.x} cy={to.y} r={5 * k} fill={color} />
      <g transform={`translate(${to.x} ${to.y}) scale(${k})`}>
        <rect x={12} y={-30} width={label.length * 9 + 16} height={26} rx={6} className="ruler-label-bg" />
        <text x={20} y={-12} className="ruler-label">
          {label}
        </text>
      </g>
    </g>
  );
}
