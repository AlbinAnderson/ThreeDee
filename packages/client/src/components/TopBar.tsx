import { useCurrentScene, useGame, useIsGm } from '../state/hooks';
import { leaveRoom, useSession } from '../state/session';
import { useUi } from '../state/uiStore';

export function TopBar() {
  const status = useSession((s) => s.status);
  const roomId = useSession((s) => s.connection?.params.roomId);
  const gm = useIsGm();
  const scene = useCurrentScene();
  const activeId = useGame((s) => s.activeSceneId);
  const activeName = useGame((s) => (s.activeSceneId ? s.scenes[s.activeSceneId]?.name : undefined));
  const viewingOther = gm && scene && scene.id !== activeId;

  return (
    <header className="topbar">
      <span className="room-name">{roomId}</span>
      <span className="scene-title">
        {scene?.name ?? 'No scene'}
        {viewingOther && (
          <>
            <span className="badge warn">GM preview</span>
            <span className="muted"> Players see: {activeName ?? 'nothing'}</span>
            <button type="button" className="small" onClick={() => useUi.getState().setViewedScene(null)}>
              Back to live
            </button>
          </>
        )}
      </span>
      <span className={`conn-status ${status}`}>{status === 'open' ? 'Connected' : status === 'connecting' ? 'Reconnecting…' : status}</span>
      <button type="button" className="small" onClick={leaveRoom}>
        Leave
      </button>
    </header>
  );
}
