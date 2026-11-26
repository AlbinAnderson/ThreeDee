import type { LayerProps } from './types';

export function BackgroundLayer({ scene }: LayerProps) {
  return (
    <g className="layer-background" pointerEvents="none">
      <rect width={scene.width} height={scene.height} fill={scene.backgroundColor} />
      {scene.background && (
        <image href={scene.background} width={scene.width} height={scene.height} preserveAspectRatio="none" />
      )}
    </g>
  );
}
