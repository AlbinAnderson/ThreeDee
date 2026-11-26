/**
 * Owns the active connection and wires its messages into the stores.
 */
import { create } from 'zustand';
import type { ClientMessage, EphemeralEvent } from '@vtt/shared';
import { GameConnection, type ConnectionStatus, type JoinParams } from '../net/connection';
import { emitEphemeral } from '../net/ephemeral';
import { handleRpcResponse, rejectAll, setRpcSender } from '../net/rpc';
import { resetCharactersUi } from '../characters/store';
import { resetActionsUi } from '../pf1e/ActionsPanel';
import { gameStore } from './gameStore';
import { notify } from './notifications';
import { useUi } from './uiStore';

interface SessionState {
  connection: GameConnection | null;
  status: ConnectionStatus | 'idle';
  /** Fatal error from the last attempt (shown on the join screen). */
  error: string | null;
}

export const useSession = create<SessionState>()(() => ({ connection: null, status: 'idle', error: null }));

export function joinRoom(params: JoinParams) {
  leaveRoom();
  const connection = new GameConnection(params);

  connection.onMessage((msg) => {
    gameStore.handleServerMessage(msg);
    if (msg.t === 'ephemeral') emitEphemeral(msg.from, msg.event);
    if (msg.t === 'response') handleRpcResponse(msg);
    if (msg.t === 'notice') notify(msg.message, 'info');
    if (msg.t === 'error' && !msg.fatal) notify(msg.message);
  });

  connection.onStatus((status, error) => {
    // Requests in flight can't be answered over a dropped socket.
    if (status !== 'open') rejectAll('Connection lost');
    if (status === 'failed') {
      gameStore.reset();
      useSession.setState({ connection: null, status: 'idle', error: error ?? 'Connection failed' });
    } else {
      useSession.setState({ status });
    }
  });

  setRpcSender((msg) => connection.send(msg));
  useSession.setState({ connection, status: 'connecting', error: null });
  connection.start();
}

export function leaveRoom() {
  useSession.getState().connection?.close();
  setRpcSender(null);
  gameStore.reset();
  useUi.getState().resetForRoom();
  resetCharactersUi();
  resetActionsUi();
  useSession.setState({ connection: null, status: 'idle' });
}

export function send(msg: ClientMessage): boolean {
  return useSession.getState().connection?.send(msg) ?? false;
}

export function sendEphemeral(event: EphemeralEvent) {
  send({ t: 'ephemeral', event });
}
