/**
 * Sidebar panel registry. Add a tab by listing a component here.
 */
import { ChatPanel } from './ChatPanel';
import { PlayersPanel } from './PlayersPanel';
import { ScenesPanel } from './ScenesPanel';
import { TokensPanel } from './TokensPanel';
import type { PanelDef } from './types';

export const panels: PanelDef[] = [
  { id: 'chat', label: 'Chat', Component: ChatPanel },
  { id: 'tokens', label: 'Tokens', Component: TokensPanel },
  { id: 'scenes', label: 'Scenes', gmOnly: true, Component: ScenesPanel },
  { id: 'players', label: 'Players', Component: PlayersPanel },
];
