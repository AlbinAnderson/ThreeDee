import type { ComponentType } from 'react';
import type { User } from '@vtt/shared';

export interface PlayerSectionProps {
  /** The player whose page is shown. */
  player: User;
  /** The person looking at it. */
  viewer: User;
  isSelf: boolean;
}

/**
 * A block on a player's page in the Players tab (notes, and later things
 * like character info, inventory, conditions...).
 */
export interface PlayerSection {
  id: string;
  title: string;
  /** Whether `viewer` should see this section on `player`'s page. Default: always. */
  visible?: (viewer: User, player: User) => boolean;
  Component: ComponentType<PlayerSectionProps>;
}
