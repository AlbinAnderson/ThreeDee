import { lazy, Suspense } from 'react';
import { DialogHost } from './components/Dialogs';
import { JoinScreen } from './components/JoinScreen';
import { Toasts } from './components/Toasts';
import { useGameStore } from './state/gameStore';
import { leaveRoom, useSession } from './state/session';

const TableView = lazy(() => import('./components/TableView').then((m) => ({ default: m.TableView })));
const RulesCompendiumModal = lazy(() => import('./rules/RulesCompendiumModal').then((m) => ({ default: m.RulesCompendiumModal })));
const RulesCardModal = lazy(() => import('./rules/RulesCardModal').then((m) => ({ default: m.RulesCardModal })));

export function App() {
  const connection = useSession((s) => s.connection);
  const ready = useGameStore((s) => s.view !== null && s.selfId !== null);

  let content;
  if (!connection) content = <JoinScreen />;
  else if (!ready)
    content = (
      <div className="join-screen">
        <div className="join-card">
          <p>Connecting to “{connection.params.roomId}”…</p>
          <button type="button" onClick={leaveRoom}>
            Cancel
          </button>
        </div>
      </div>
    );
  else
    content = (
      <Suspense fallback={<div className="join-screen"><div className="join-card"><p>Loading table…</p></div></div>}>
        <TableView />
      </Suspense>
    );

  return (
    <>
      {content}
      {ready && (
        <Suspense fallback={null}>
          <RulesCompendiumModal />
          <RulesCardModal />
        </Suspense>
      )}
      <Toasts />
      <DialogHost />
    </>
  );
}
