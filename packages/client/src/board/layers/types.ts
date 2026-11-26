import type { ComponentType } from 'react';
import type { Scene } from '@vtt/shared';

export interface LayerProps {
  scene: Scene;
}

/**
 * A board layer renders inside the camera transform, in scene coordinates.
 * Layers are drawn in registry order (first = bottom).
 */
export interface BoardLayer {
  id: string;
  Component: ComponentType<LayerProps>;
}
