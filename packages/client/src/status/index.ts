/**
 * Status tab section registry. Add sections (buffs, resources...) here as
 * `{ id, title, gmOnly?, Component }`.
 */
import type { ComponentType } from 'react';
import { EffectsSection } from './EffectsSection';
import { OthersSection, PartySection } from './TokenStatusList';

export interface StatusSection {
  id: string;
  title: string;
  gmOnly?: boolean;
  Component: ComponentType;
}

export const statusSections: StatusSection[] = [
  { id: 'party', title: 'Party', Component: PartySection },
  { id: 'effects', title: 'Buffs & conditions', Component: EffectsSection },
  { id: 'others', title: 'Others on this scene', gmOnly: true, Component: OthersSection },
];
