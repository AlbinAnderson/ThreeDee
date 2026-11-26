/**
 * Status tab section registry. Empty for now; add things like HP,
 * conditions, buffs or initiative here as `{ id, title, Component }`.
 */
import type { ComponentType } from 'react';

export interface StatusSection {
  id: string;
  title: string;
  gmOnly?: boolean;
  Component: ComponentType;
}

export const statusSections: StatusSection[] = [];
