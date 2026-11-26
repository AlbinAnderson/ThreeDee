/**
 * Client side of request/response operations (see shared/src/rpc.ts).
 *
 *   const snapshots = await request('snapshots.list', {});
 */
import { newId, type RpcArgs, type RpcOp, type RpcResults, type ServerMessage } from '@vtt/shared';

const TIMEOUT_MS = 20_000;

interface Pending {
  resolve(data: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let sender: ((msg: { t: 'request'; reqId: string; op: string; args: unknown }) => boolean) | null = null;

/** Called by the session when a connection is (re)established or dropped. */
export function setRpcSender(fn: typeof sender) {
  sender = fn;
  if (!fn) rejectAll('Disconnected');
}

export function handleRpcResponse(msg: Extract<ServerMessage, { t: 'response' }>) {
  const p = pending.get(msg.reqId);
  if (!p) return;
  pending.delete(msg.reqId);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.data);
  else p.reject(new Error(msg.error));
}

export function rejectAll(reason: string) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
}

export function request<K extends RpcOp>(op: K, args: RpcArgs<K>): Promise<RpcResults[K]> {
  return new Promise((resolve, reject) => {
    const reqId = newId();
    if (!sender?.({ t: 'request', reqId, op, args })) return reject(new Error('Not connected to the server'));
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('The server took too long to respond'));
    }, TIMEOUT_MS);
    pending.set(reqId, { resolve: resolve as (d: unknown) => void, reject, timer });
  });
}
