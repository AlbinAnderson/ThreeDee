import { DialogHost } from './components/Dialogs';
import { JoinScreen } from './components/JoinScreen';
import { TableView } from './components/TableView';
import { Toasts } from './components/Toasts';
import { useGameStore } from './state/gameStore';
import { leaveRoom, useSession } from './state/session';

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
  else content = <TableView />;

  return (
    <>
      {content}
      <Toasts />
      <DialogHost />
    </>
  );
}
