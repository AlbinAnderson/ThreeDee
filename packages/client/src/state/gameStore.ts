/**
 * Client copy of the room's game state.
 *
 * `confirmed` is exactly what the server has acknowledged. Actions the local
 * user dispatches are applied optimistically on top as `pending` until the
 * server echoes (or rejects) them. `view` = confirmed + pending, and is what
 * the UI renders.
 */
import { create } from 'zustand';
import { applyAction, redactState, type Action, type ActionMeta, type GameState, type ServerMessage, type User, type UserId } from '@vtt/shared';
import { notify } from './notifications';

export interface PendingAction {
  clientId: string;
  action: Action;
  meta: ActionMeta;
}

interface GameStoreState {
  confirmed: GameState | null;
  pending: PendingAction[];
  view: GameState | null;
  selfId: UserId | null;
  online: UserId[];
  seq: number;
  /** serverNow ≈ Date.now() + clockOffset */
  clockOffset: number;
}

const initial: GameStoreState = { confirmed: null, pending: [], view: null, selfId: null, online: [], seq: 0, clockOffset: 0 };

export const useGameStore = create<GameStoreState>()(() => initial);

function rebase(confirmed: GameState, pending: PendingAction[]): GameState {
  return pending.reduce((s, p) => applyAction(s, p.action, p.meta), confirmed);
}

export const gameStore = {
  reset() {
    useGameStore.setState(initial, true);
  },

  addPending(p: PendingAction) {
    useGameStore.setState((s) => {
      const pending = [...s.pending, p];
      return { pending, view: s.view && applyAction(s.view, p.action, p.meta) };
    });
  },

  handleServerMessage(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome':
        useGameStore.setState({
          confirmed: msg.state,
          view: msg.state,
          pending: [],
          selfId: msg.self.id,
          seq: msg.seq,
          clockOffset: (msg.serverTime ?? Date.now()) - Date.now(),
        });
        break;
      case 'action':
        useGameStore.setState((s) => {
          if (!s.confirmed) return s;
          if (msg.seq !== s.seq + 1) console.warn(`[game] sequence gap: expected ${s.seq + 1}, got ${msg.seq}`);
          // Re-redact so data that stopped being visible to us (e.g. an un-shared handout) disappears.
          const applied = applyAction(s.confirmed, msg.action, msg.meta);
          const self = s.selfId ? applied.users[s.selfId] : undefined;
          const confirmed = self ? redactState(applied, self) : applied;
          const pending = msg.clientId ? s.pending.filter((p) => p.clientId !== msg.clientId) : s.pending;
          return { confirmed, pending, view: rebase(confirmed, pending), seq: msg.seq };
        });
        break;
      case 'reject':
        notify(msg.reason);
        useGameStore.setState((s) => {
          if (!s.confirmed) return s;
          const pending = s.pending.filter((p) => p.clientId !== msg.clientId);
          return { pending, view: rebase(s.confirmed, pending) };
        });
        break;
      case 'presence':
        useGameStore.setState({ online: msg.online });
        break;
    }
  },
};

/** Current user, resolved from live state so role/name changes show up. */
export function getSelf(): User | null {
  const { view, selfId } = useGameStore.getState();
  return (selfId && view?.users[selfId]) || null;
}

/** Best estimate of the server's clock. */
export function serverNow(): number {
  return Date.now() + useGameStore.getState().clockOffset;
}
