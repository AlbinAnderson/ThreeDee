/**
 * Crisp Lucide SVG icons for sidebar panels and board tools.
 */
import type { ComponentType } from 'react';
import {
  BrickWall,
  CircleDot,
  CloudFog,
  Coins,
  Dices,
  Eraser,
  HeartPulse,
  History,
  IdCard,
  Map,
  MessageSquare,
  MousePointer2,
  Music,
  Pencil,
  Radio,
  Ruler,
  ScrollText,
  Shapes,
  Sun,
  Swords,
  Users,
  Zap,
} from 'lucide-react';

type IconComp = ComponentType<{ size?: number; strokeWidth?: number }>;

const PANEL_ICONS: Record<string, IconComp> = {
  chat: MessageSquare,
  combat: Swords,
  actions: Zap,
  status: HeartPulse,
  players: Users,
  characters: IdCard,
  loot: Coins,
  handouts: ScrollText,
  random: Dices,
  tokens: CircleDot,
  audio: Music,
  scenes: Map,
  history: History,
};

const TOOL_ICONS: Record<string, IconComp> = {
  select: MousePointer2,
  ruler: Ruler,
  ping: Radio,
  template: Shapes,
  draw: Pencil,
  erase: Eraser,
  fog: CloudFog,
  wall: BrickWall,
  light: Sun,
};

export function PanelIcon({ id, fallback }: { id: string; fallback: string }) {
  const Icon = PANEL_ICONS[id];
  return Icon ? <Icon size={17} strokeWidth={1.85} /> : <>{fallback}</>;
}

export function ToolIcon({ id, fallback }: { id: string; fallback: string }) {
  const Icon = TOOL_ICONS[id];
  return Icon ? <Icon size={16} strokeWidth={1.9} /> : <>{fallback}</>;
}
