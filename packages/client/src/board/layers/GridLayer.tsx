import type { LayerProps } from './types';

export function GridLayer({ scene }: LayerProps) {
  const { grid } = scene;
  if (grid.type === 'none') return null;
  const patternId = `grid-${scene.id}`;
  return (
    <g className="layer-grid" pointerEvents="none">
      <defs>
        <pattern
          id={patternId}
          width={grid.size}
          height={grid.size}
          patternUnits="userSpaceOnUse"
          x={grid.offsetX}
          y={grid.offsetY}
        >
          <path
            d={`M ${grid.size} 0 L 0 0 0 ${grid.size}`}
            fill="none"
            stroke={grid.color}
            strokeOpacity={grid.opacity}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
      </defs>
      <rect width={scene.width} height={scene.height} fill={`url(#${patternId})`} />
    </g>
  );
}
