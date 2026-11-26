/**
 * Request/response operations ("RPC") for things that aren't game actions:
 * server-side queries and room administration such as snapshots. Game state
 * changes still go through actions.
 *
 * To add an op: add its args schema to `rpcArgs`, its result type to
 * `RpcResults`, and a handler in server/src/rpc.
 */
import { z } from 'zod';

export const SnapshotReasonSchema = z.enum(['auto', 'manual', 'pre-restore', 'import']);
export type SnapshotReason = z.infer<typeof SnapshotReasonSchema>;

export interface SnapshotInfo {
  id: number;
  roomId: string;
  createdAt: number;
  reason: SnapshotReason;
  label: string | null;
  /** Compressed size on disk. */
  sizeBytes: number;
}

export const rpcArgs = {
  'snapshots.list': z.object({}),
  'snapshots.create': z.object({ label: z.string().trim().max(80).optional() }),
  'snapshots.restore': z.object({ id: z.number().int().positive() }),
};

export interface RpcResults {
  'snapshots.list': SnapshotInfo[];
  'snapshots.create': SnapshotInfo;
  'snapshots.restore': null;
}

export type RpcOp = keyof typeof rpcArgs;
export type RpcArgs<K extends RpcOp> = z.input<(typeof rpcArgs)[K]>;
