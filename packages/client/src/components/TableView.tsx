import { useEffect } from 'react';
import { canControlToken, tokenActions } from '@vtt/shared';
import { Board } from '../board/Board';
import { confirmDialog, useDialogStore } from '../state/dialogs';
import { dispatch } from '../state/dispatch';
import { getSelf, useGameStore } from '../state/gameStore';
import { useUi } from '../state/uiStore';
import { tools } from '../tools';
import { AudioEngine } from '../audio/AudioEngine';
import { CharacterPopout } from '../characters/CharactersPanel';
import { ImportDialog } from '../characters/ImportDialog';
import { useCharactersUi } from '../characters/store';
import { HandoutViewer } from '../handouts/HandoutsPanel';
import { Hotbar } from '../player/MacrosSection';
import { TurnBar } from '../pf1e/ActionsPanel';
import { RollToasts } from './RollToasts';
import { ShortcutsModal } from './ShortcutsModal';
import { Sidebar } from './Sidebar';
import { TokenInspector } from './TokenInspector';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useDialogStore.getState().current) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useUi.getState();

      if (e.key === '?') {
        e.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        ui.toggleSidebar();
        return;
      }
      if (e.key === 'Escape') {
        if (ui.shortcutsOpen) return ui.setShortcutsOpen(false);
        if (useCharactersUi.getState().poppedOut) return useCharactersUi.setState({ poppedOut: false });
        return ui.clearSelection();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const self = getSelf();
        const tokens = useGameStore.getState().view?.tokens ?? {};
        const removable = ui.selectedTokenIds.map((id) => tokens[id]).filter((t): t is NonNullable<typeof t> => !!t && !!self && canControlToken(self, t));
        if (!removable.length) return;
        e.preventDefault();
        const label = removable.length === 1 ? `"${removable[0]!.name || 'Token'}"` : `${removable.length} selected tokens`;
        void confirmDialog({
          title: 'Remove token?',
          message: `Remove ${label} from the scene?`,
          confirmLabel: 'Remove',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          for (const t of removable) dispatch(tokenActions.remove.create({ id: t.id }));
          useUi.getState().clearSelection();
        });
        return;
      }
      const tool = tools.find((t) => t.hotkey === e.key.toLowerCase());
      if (tool) ui.setTool(tool.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function TableView() {
  useHotkeys();
  return (
    <div className="table-view">
      <TopBar />
      <div className="table-main">
        <div className="board-area">
          <Board />
          <Toolbar />
          <TokenInspector />
          <RollToasts />
          <div className="hud-bottom">
            <Hotbar />
            <TurnBar />
          </div>
        </div>
        <Sidebar />
      </div>
      <CharacterPopout />
      <ShortcutsModal />
      <HandoutViewer />
      <AudioEngine />
      <ImportDialog />
    </div>
  );
}
