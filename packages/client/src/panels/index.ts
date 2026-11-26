/**
 * Sidebar panel registry. Add a tab by listing a component here.
 */
import { LootPanel } from '../loot/LootPanel';
import { StatusPanel } from '../status/StatusPanel';
import { ChatPanel } from './ChatPanel';
import { HistoryPanel } from './HistoryPanel';
import { PlayersPanel } from './PlayersPanel';
import { ScenesPanel } from './ScenesPanel';
import { TokensPanel } from './TokensPanel';
import type { PanelDef } from './types';

export const panels: PanelDef[] = [
  { id: 'chat', label: 'Chat', Component: ChatPanel },
  { id: 'players', label: 'Players', Component: PlayersPanel },
  { id: 'status', label: 'Status', Component: StatusPanel },
  { id: 'loot', label: 'Loot', Component: LootPanel },
  { id: 'tokens', label: 'Tokens', Component: TokensPanel },
  { id: 'scenes', label: 'Scenes', gmOnly: true, Component: ScenesPanel },
  { id: 'history', label: 'History', gmOnly: true, Component: HistoryPanel },
];
