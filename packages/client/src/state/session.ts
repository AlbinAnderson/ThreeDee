/**
 * Owns the active connection and wires its messages into the stores.
 */
import { create } from 'zustand';
import type { ClientMessage, EphemeralEvent } from '@vtt/shared';
import { GameConnection, type ConnectionStatus, type JoinParams } from '../net/connection';
import { emitEphemeral } from '../net/ephemeral';
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
    if (msg.t === 'error' && !msg.fatal) notify(msg.message);
  });

  connection.onStatus((status, error) => {
    if (status === 'failed') {
      gameStore.reset();
      useSession.setState({ connection: null, status: 'idle', error: error ?? 'Connection failed' });
    } else {
      useSession.setState({ status });
    }
  });

  useSession.setState({ connection, status: 'connecting', error: null });
  connection.start();
}

export function leaveRoom() {
  useSession.getState().connection?.close();
  gameStore.reset();
  useUi.getState().resetForRoom();
  useSession.setState({ connection: null, status: 'idle' });
}

export function send(msg: ClientMessage): boolean {
  return useSession.getState().connection?.send(msg) ?? false;
}

export function sendEphemeral(event: EphemeralEvent) {
  send({ t: 'ephemeral', event });
}
