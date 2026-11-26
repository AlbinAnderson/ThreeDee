/**
 * Board layer registry, bottom to top. Add new visual layers here
 * (fog of war, drawings, templates/AoE, lighting...).
 */
import { BackgroundLayer } from './BackgroundLayer';
import { DrawingLayer } from './DrawingLayer';
import { GridLayer } from './GridLayer';
import { PingLayer } from './PingLayer';
import { RulerLayer } from './RulerLayer';
import { TokenLayer } from './TokenLayer';
import type { BoardLayer } from './types';

export const boardLayers: BoardLayer[] = [
  { id: 'background', Component: BackgroundLayer },
  { id: 'grid', Component: GridLayer },
  { id: 'drawings', Component: DrawingLayer },
  { id: 'tokens', Component: TokenLayer },
  { id: 'ruler', Component: RulerLayer },
  { id: 'pings', Component: PingLayer },
];
