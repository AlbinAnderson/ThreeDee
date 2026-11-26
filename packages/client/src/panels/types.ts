import type { ComponentType } from 'react';

/** A sidebar panel, shown as an icon in the sidebar rail. */
export interface PanelDef {
  id: string;
  label: string;
  /** Short glyph for the rail. */
  icon: string;
  gmOnly?: boolean;
  Component: ComponentType;
}
