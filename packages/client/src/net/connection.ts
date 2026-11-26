import type { ClientMessage, JoinMessage, ServerMessage } from '@vtt/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'failed';
export type JoinParams = Omit<JoinMessage, 't'>;

/**
 * Reconnect delay (ms). Retry every 250ms for the first ~5s, since the common
 * case is the server restarting (deploy, or `tsx watch` in dev) and being back
 * within a couple of seconds; then back off to every 5s.
 */
function retryDelay(attempt: number): number {
  if (attempt < 20) return 250;
  return Math.min(5000, 1000 * 2 ** (attempt - 20));
}

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
    window.addEventListener('online', this.retryNow);
    document.addEventListener('visibilitychange', this.retryNow);
    this.open();
  }

  close() {
    this.stopped = true;
    window.removeEventListener('online', this.retryNow);
    document.removeEventListener('visibilitychange', this.retryNow);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.setStatus('closed');
  }

  /** Skip the remaining backoff (network came back, or the tab was refocused). */
  private retryNow = () => {
    if (this.stopped || this.ws || !this.reconnectTimer || document.visibilityState === 'hidden') return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.open();
  };

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
      const delay = retryDelay(this.retries++);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.open();
      }, delay);
    };
  }

  private setStatus(status: ConnectionStatus, error?: string) {
    this.status = status;
    for (const l of this.statusListeners) l(status, error);
  }
}
