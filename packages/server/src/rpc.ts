/**
 * Server handlers for request/response operations (see shared/src/rpc.ts).
 */
import { randomInt } from 'node:crypto';
import { isGm, isSourceAllowed, rpcArgs, type RpcOp, type RpcResults, type TreasureBand, type User } from '@vtt/shared';
import type { z } from 'zod';
import { paths } from './config';
import type { Client, Room } from './rooms/Room';
import { AonFetcher } from './rules/aon';
import { createRulesPackStore, type RulesPackStore } from './rules/packStore';

export interface RpcServices {
  rulesStore: RulesPackStore;
  aonFetcher: AonFetcher;
}

let services: RpcServices | null = null;

export function setRpcServices(next: RpcServices) {
  services = next;
}

function getServices(): RpcServices {
  if (!services) {
    services = {
      rulesStore: createRulesPackStore(paths.rules),
      aonFetcher: new AonFetcher({ cacheDir: paths.aonCache }),
    };
  }
  return services;
}

interface RpcContext {
  room: Room;
  client: Client;
  user: User;
  services: RpcServices;
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
  'rules.status': {
    gmOnly: false,
    async handle({ services: svc }) {
      return svc.rulesStore.status();
    },
  },
  'rules.books': {
    gmOnly: false,
    async handle({ services: svc }) {
      return svc.rulesStore.books();
    },
  },
  'rules.search': {
    gmOnly: false,
    async handle({ room, user, services: svc }, args) {
      const gm = isGm(user);
      const allowedSources = gm && args.allSources ? null : room.currentState.rules.allowedSources;
      return svc.rulesStore.search({
        kind: args.kind,
        q: args.q,
        allowedSources,
        customRules: room.currentState.customRules,
        isGm: gm,
        limit: args.limit,
      });
    },
  },
  'rules.get': {
    gmOnly: false,
    async handle({ room, user, services: svc }, args) {
      const gm = isGm(user);
      if (args.customId) {
        const cr = room.currentState.customRules[args.customId];
        if (!cr || (cr.gmOnly && !gm)) return { record: null, custom: null };
        return { record: null, custom: cr };
      }
      let rec = args.key ? svc.rulesStore.get(args.kind, args.key) : undefined;
      if (!rec && args.name) rec = svc.rulesStore.byName(args.kind, args.name);
      if (rec && !gm && !isSourceAllowed(room.currentState.rules.allowedSources, rec.source.campaign)) {
        rec = undefined;
      }
      // Also match custom rules by name if not found in the pack.
      let custom = null;
      if (!rec && args.name) {
        const lower = args.name.trim().toLowerCase();
        custom =
          Object.values(room.currentState.customRules).find(
            (cr) => (!cr.gmOnly || gm) && (cr.kind === args.kind || (args.kind === 'ability' && cr.kind === 'feat')) && cr.name.toLowerCase() === lower,
          ) ?? null;
      }
      return { record: rec ?? null, custom };
    },
  },
  'rules.rollTreasure': {
    gmOnly: true,
    async handle({ room, services: svc }, args) {
      const allowedSources = args.allSources ? null : room.currentState.rules.allowedSources;
      return {
        items: svc.rulesStore.rollTreasure({
          band: args.band as TreasureBand | undefined,
          type: args.type,
          slot: args.slot,
          count: args.count,
          allowedSources,
          random: randomInt,
        }),
      };
    },
  },
  'rules.fetchAon': {
    gmOnly: true,
    async handle({ services: svc }, args) {
      return svc.aonFetcher.lookup({ url: args.url, kind: args.kind, name: args.name });
    },
  },
};

export async function handleRequest(client: Client, reqId: string, op: string, rawArgs: unknown, overrideServices?: RpcServices) {
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
    const data = await handler.handle({ room, client, user, services: overrideServices ?? getServices() }, args.data as never);
    client.send({ t: 'response', reqId, ok: true, data });
  } catch (e) {
    console.error(`[rpc] ${op} failed`, e);
    fail(e instanceof Error ? e.message : 'Server error');
  }
}
