import type { ComponentType } from 'react';

/** A sidebar tab. */
export interface PanelDef {
  id: string;
  label: string;
  gmOnly?: boolean;
  Component: ComponentType;
}
