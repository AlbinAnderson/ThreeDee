/**
 * Sidebar panel registry, in rail order. Add a panel by listing it here.
 */
import { AudioPanel } from '../audio/AudioPanel';
import { CharactersPanel } from '../characters/CharactersPanel';
import { HandoutsPanel } from '../handouts/HandoutsPanel';
import { LootPanel } from '../loot/LootPanel';
import { RandomPanel } from '../random/RandomPanel';
import { StatusPanel } from '../status/StatusPanel';
import { ChatPanel } from './ChatPanel';
import { CombatPanel } from './CombatPanel';
import { HistoryPanel } from './HistoryPanel';
import { PlayersPanel } from './PlayersPanel';
import { ScenesPanel } from './ScenesPanel';
import { TokensPanel } from './TokensPanel';
import type { PanelDef } from './types';

export const panels: PanelDef[] = [
  { id: 'chat', label: 'Chat', icon: '💬', Component: ChatPanel },
  { id: 'combat', label: 'Combat', icon: '⚔', Component: CombatPanel },
  { id: 'status', label: 'Status', icon: '❤', Component: StatusPanel },
  { id: 'players', label: 'Players', icon: '👥', Component: PlayersPanel },
  { id: 'characters', label: 'Characters', icon: '📇', Component: CharactersPanel },
  { id: 'loot', label: 'Loot', icon: '💰', Component: LootPanel },
  { id: 'handouts', label: 'Handouts', icon: '📜', Component: HandoutsPanel },
  { id: 'random', label: 'Tables & decks', icon: '🎲', Component: RandomPanel },
  { id: 'tokens', label: 'Tokens', icon: '⬤', Component: TokensPanel },
  { id: 'audio', label: 'Audio', icon: '♫', Component: AudioPanel },
  { id: 'scenes', label: 'Scenes', icon: '🗺', gmOnly: true, Component: ScenesPanel },
  { id: 'history', label: 'History', icon: '⟲', gmOnly: true, Component: HistoryPanel },
];
