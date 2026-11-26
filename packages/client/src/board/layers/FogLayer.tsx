import { memo } from 'react';
import type { FogOp } from '@vtt/shared';
import { useIsGm } from '../../state/hooks';
import { useFogTool } from '../../tools/fogTool';
import type { LayerProps } from './types';

/**
 * Fog of war: a black sheet with holes. Built as an SVG mask where white =
 * fogged; reveal strokes paint black (holes), hide strokes paint white back.
 * Players see it opaque; the GM sees through it.
 */
export function FogLayer({ scene }: LayerProps) {
  const gm = useIsGm();
  const preview = useFogTool((s) => s.preview);
  if (!scene.fog.enabled) return null;
  const maskId = `fog-mask-${scene.id}`;
  const pad = Math.max(scene.width, scene.height); // cover past the scene edges too

  return (
    <g className="layer-fog" pointerEvents="none">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-pad} y={-pad} width={scene.width + 2 * pad} height={scene.height + 2 * pad}>
          <rect x={-pad} y={-pad} width={scene.width + 2 * pad} height={scene.height + 2 * pad} fill="white" />
          <FogOps ops={scene.fog.ops} />
          {preview && preview.id && <FogOpShape op={preview} />}
        </mask>
      </defs>
      <rect
        x={-pad}
        y={-pad}
        width={scene.width + 2 * pad}
        height={scene.height + 2 * pad}
        fill={gm ? '#1b1d2a' : '#0b0b0d'}
        opacity={gm ? 0.55 : 1}
        mask={`url(#${maskId})`}
      />
    </g>
  );
}

const FogOps = memo(function FogOps({ ops }: { ops: FogOp[] }) {
  return (
    <>
      {ops.map((op) => (
        <FogOpShape key={op.id} op={op} />
      ))}
    </>
  );
});

function FogOpShape({ op }: { op: FogOp }) {
  const color = op.mode === 'reveal' ? 'black' : 'white';
  const p = op.points;
  switch (op.shape) {
    case 'all':
      return <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill={color} />;
    case 'rect': {
      const [x0, y0, x1, y1] = p as [number, number, number, number];
      return <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} fill={color} />;
    }
    case 'ellipse': {
      const [x0, y0, x1, y1] = p as [number, number, number, number];
      return <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={Math.abs(x1 - x0) / 2} ry={Math.abs(y1 - y0) / 2} fill={color} />;
    }
    case 'brush': {
      let d = `M ${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += ` L ${p[i]} ${p[i + 1]}`;
      if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) d += ' l 0.01 0';
      return <path d={d} fill="none" stroke={color} strokeWidth={op.width} strokeLinecap="round" strokeLinejoin="round" />;
    }
  }
}
