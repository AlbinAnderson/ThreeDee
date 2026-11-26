import type { ClientMessage, JoinMessage, ServerMessage } from '@vtt/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'failed';
export type JoinParams = Omit<JoinMessage, 't'>;

type MessageListener = (msg: ServerMessage) => void;
type StatusListener = (status: ConnectionStatus, error?: string) => void;

/**
 * A single WebSocket connection to a room, with automatic reconnect.
 * Knows nothing about game state; consumers subscribe to messages.
 */
export class GameConnection {
  private ws: WebSocket | null = null;
  private retries = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  status: ConnectionStatus = 'connecting';

  constructor(readonly params: JoinParams) {}

  start() {
    this.stopped = false;
    this.open();
  }

  close() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.setStatus('closed');
  }

  /** Returns false if the message could not be sent (not connected). */
  send(msg: ClientMessage): boolean {
    if (this.status !== 'open' || this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  onMessage(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.setStatus('connecting');

    ws.onopen = () => {
      this.retries = 0;
      ws.send(JSON.stringify({ t: 'join', ...this.params } satisfies ClientMessage));
    };

    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.setStatus('open');
      if (msg.t === 'error' && msg.fatal) {
        this.stopped = true;
        this.setStatus('failed', msg.message);
      }
      for (const l of this.messageListeners) l(msg);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.setStatus('connecting');
      const delay = Math.min(10_000, 500 * 2 ** this.retries++);
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  private setStatus(status: ConnectionStatus, error?: string) {
    this.status = status;
    for (const l of this.statusListeners) l(status, error);
  }
}
