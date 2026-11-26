/**
 * Player page section registry (Players tab), top to bottom.
 * Add per-player features here.
 */
import { isGm } from '@vtt/shared';
import { NotesSection } from './NotesSection';
import { ProfileSection } from './ProfileSection';
import type { PlayerSection } from './types';

export const playerSections: PlayerSection[] = [
  { id: 'profile', title: 'Profile', Component: ProfileSection },
  {
    id: 'notes',
    title: 'Notes',
    visible: (viewer, player) => viewer.id === player.id || isGm(viewer),
    Component: NotesSection,
  },
];
