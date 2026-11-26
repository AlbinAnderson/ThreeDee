/**
 * Server handlers for request/response operations (see shared/src/rpc.ts).
 */
import { isGm, rpcArgs, type RpcOp, type RpcResults, type User } from '@vtt/shared';
import type { z } from 'zod';
import type { Client, Room } from './rooms/Room';

interface RpcContext {
  room: Room;
  client: Client;
  user: User;
}

interface RpcHandler<K extends RpcOp> {
  gmOnly: boolean;
  handle(ctx: RpcContext, args: z.output<(typeof rpcArgs)[K]>): Promise<RpcResults[K]>;
}

const handlers: { [K in RpcOp]: RpcHandler<K> } = {
  'snapshots.list': {
    gmOnly: true,
    handle: ({ room }) => room.listSnapshots(),
  },
  'snapshots.create': {
    gmOnly: true,
    handle: ({ room }, { label }) => room.createSnapshot('manual', label || null),
  },
  'snapshots.restore': {
    gmOnly: true,
    async handle({ room, user }, { id }) {
      await room.restore(id, user);
      return null;
    },
  },
};

export async function handleRequest(client: Client, reqId: string, op: string, rawArgs: unknown) {
  const fail = (error: string) => client.send({ t: 'response', reqId, ok: false, error });
  const { room, user } = client;
  if (!room || !user) return fail('Join a room first');
  if (!(op in handlers)) return fail(`Unknown operation "${op}"`);

  const key = op as RpcOp;
  const handler = handlers[key] as RpcHandler<RpcOp>;
  if (handler.gmOnly && !isGm(user)) return fail('Only the GM can do that');
  const args = rpcArgs[key].safeParse(rawArgs ?? {});
  if (!args.success) return fail(args.error.issues[0]?.message ?? 'Invalid arguments');

  try {
    const data = await handler.handle({ room, client, user }, args.data as never);
    client.send({ t: 'response', reqId, ok: true, data });
  } catch (e) {
    console.error(`[rpc] ${op} failed`, e);
    fail(e instanceof Error ? e.message : 'Server error');
  }
}
