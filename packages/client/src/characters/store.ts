import { create } from 'zustand';
import type { PcgenCharacter } from '@vtt/shared';

/** Which character is open in the Characters panel. */
export const useCharactersUi = create<{ selectedId: string | null }>(() => ({ selectedId: null }));

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
  useCharactersUi.setState({ selectedId: null });
  useImportDialog.setState({ current: null });
}
