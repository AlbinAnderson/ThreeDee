import { create } from 'zustand';
import type { AbilityCategory, PcgenCharacter } from '@vtt/shared';

export type CharacterTab = 'sheet' | 'skills' | 'abilities' | 'spells' | 'effects' | 'inventory' | 'imported' | 'settings' | 'manage';
export type SkillFilter = 'all' | 'trained' | 'usable' | 'favorites';

interface CharactersUiState {
  selectedId: string | null;
  tab: CharacterTab;
  poppedOut: boolean;
  skillsQuery: string;
  skillsFilter: SkillFilter;
  abilitiesQuery: string;
  abilitiesCategory: AbilityCategory | 'all';
}

/** Persistent UI state for the Characters panel so switching sidebar panels never resets your tab/filters. */
export const useCharactersUi = create<CharactersUiState>(() => ({
  selectedId: null,
  tab: 'sheet',
  poppedOut: false,
  skillsQuery: '',
  skillsFilter: 'all',
  abilitiesQuery: '',
  abilitiesCategory: 'all',
}));

export interface ImportState {
  openId: string;
  build: PcgenCharacter;
  fileName: string;
  /** Re-import onto this character; undefined = new character. */
  targetId?: string;
}

/** The import / re-import preview currently open, if any. */
export const useImportDialog = create<{ current: ImportState | null }>(() => ({ current: null }));

export function resetCharactersUi() {
  useCharactersUi.setState({
    selectedId: null,
    tab: 'sheet',
    poppedOut: false,
    skillsQuery: '',
    skillsFilter: 'all',
    abilitiesQuery: '',
    abilitiesCategory: 'all',
  });
  useImportDialog.setState({ current: null });
}
