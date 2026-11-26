import { useEffect } from 'react';
import { onEphemeral } from '../../net/ephemeral';
import { useGameStore } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { useInteraction } from '../interactionStore';
import type { LayerProps } from './types';

export function PingLayer({ scene }: LayerProps) {
  const pings = useInteraction((s) => s.pings);
  const zoom = useUi((s) => s.camera.zoom);

  useEffect(
    () =>
      onEphemeral('ping', (from, e) => {
        const color = useGameStore.getState().view?.users[from]?.color ?? '#ffffff';
        useInteraction.getState().addPing({ sceneId: e.sceneId, x: e.x, y: e.y, color });
      }),
    [],
  );

  const k = 1 / zoom;
  return (
    <g className="layer-pings" pointerEvents="none">
      {pings
        .filter((p) => p.sceneId === scene.id)
        .map((p) => (
          <g key={p.id} transform={`translate(${p.x} ${p.y}) scale(${k})`}>
            <circle r={40} className="ping-ring" stroke={p.color} />
            <circle r={40} className="ping-ring delay" stroke={p.color} />
            <circle r={6} fill={p.color} />
          </g>
        ))}
    </g>
  );
}
