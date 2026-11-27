import { create } from 'zustand';
import type { AonKind, RulesKind } from '@vtt/shared';

export interface RulesCardTarget {
  kind: RulesKind;
  name: string;
  key?: string;
  customId?: string;
  aonKind?: AonKind;
}

export type CompendiumTab = 'search' | 'sources' | 'aon' | 'monster';

interface RulesUiState {
  card: RulesCardTarget | null;
  compendiumOpen: boolean;
  compendiumTab: CompendiumTab;
  openCard(target: RulesCardTarget): void;
  closeCard(): void;
  openCompendium(tab?: CompendiumTab): void;
  closeCompendium(): void;
}

export const useRulesUi = create<RulesUiState>((set) => ({
  card: null,
  compendiumOpen: false,
  compendiumTab: 'search',
  openCard: (card) => set({ card }),
  closeCard: () => set({ card: null }),
  openCompendium: (tab) => set((s) => ({ compendiumOpen: true, compendiumTab: tab ?? s.compendiumTab })),
  closeCompendium: () => set({ compendiumOpen: false }),
}));

export function openRulesCard(target: RulesCardTarget) {
  useRulesUi.getState().openCard(target);
}

export function resetRulesUi() {
  useRulesUi.setState({ card: null, compendiumOpen: false, compendiumTab: 'search' });
}
