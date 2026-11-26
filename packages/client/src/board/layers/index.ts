/**
 * Board layer registry, bottom to top. Add new visual layers here.
 */
import { BackgroundLayer } from './BackgroundLayer';
import { DrawingLayer } from './DrawingLayer';
import { FogLayer } from './FogLayer';
import { GridLayer } from './GridLayer';
import { LightLayer } from './LightLayer';
import { PingLayer } from './PingLayer';
import { RulerLayer } from './RulerLayer';
import { TemplateLayer } from './TemplateLayer';
import { TokenLayer } from './TokenLayer';
import type { BoardLayer } from './types';
import { VisionLayer } from './VisionLayer';
import { WallLayer } from './WallLayer';

export const boardLayers: BoardLayer[] = [
  { id: 'background', Component: BackgroundLayer },
  { id: 'grid', Component: GridLayer },
  { id: 'templates', Component: TemplateLayer },
  { id: 'drawings', Component: DrawingLayer },
  { id: 'tokens', Component: TokenLayer },
  // What players can't see goes on top of the map content...
  { id: 'vision', Component: VisionLayer },
  { id: 'fog', Component: FogLayer },
  // ...and table furniture above that.
  { id: 'walls', Component: WallLayer },
  { id: 'lights', Component: LightLayer },
  { id: 'ruler', Component: RulerLayer },
  { id: 'pings', Component: PingLayer },
];
