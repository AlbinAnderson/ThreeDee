import { useEffect } from 'react';
import { canControlToken, tokenActions } from '@vtt/shared';
import { Board } from '../board/Board';
import { dispatch } from '../state/dispatch';
import { getSelf, useGameStore } from '../state/gameStore';
import { useUi } from '../state/uiStore';
import { tools } from '../tools';
import { Sidebar } from './Sidebar';
import { TokenInspector } from './TokenInspector';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useUi.getState();

      if (e.key === 'Escape') return ui.clearSelection();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const self = getSelf();
        const tokens = useGameStore.getState().view?.tokens ?? {};
        for (const id of ui.selectedTokenIds) {
          const t = tokens[id];
          if (t && self && canControlToken(self, t)) dispatch(tokenActions.remove.create({ id }));
        }
        ui.clearSelection();
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
        </div>
        <Sidebar />
      </div>
    </div>
  );
}
