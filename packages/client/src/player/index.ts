/**
 * Player page section registry (Players tab), top to bottom.
 * Add per-player features here.
 */
import { isGm } from '@vtt/shared';
import { MacrosSection } from './MacrosSection';
import { NotesSection } from './NotesSection';
import { ProfileSection } from './ProfileSection';
import type { PlayerSection } from './types';

export const playerSections: PlayerSection[] = [
  { id: 'profile', title: 'Profile', Component: ProfileSection },
  { id: 'macros', title: 'Saved rolls', Component: MacrosSection },
  {
    id: 'notes',
    title: 'Notes',
    visible: (viewer, player) => viewer.id === player.id || isGm(viewer),
    Component: NotesSection,
  },
];
