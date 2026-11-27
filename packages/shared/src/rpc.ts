/**
 * Request/response operations ("RPC") for things that aren't game actions:
 * server-side queries and room administration such as snapshots. Game state
 * changes still go through actions.
 *
 * To add an op: add its args schema to `rpcArgs`, its result type to
 * `RpcResults`, and a handler in server/src/rpc.
 */
import { z } from 'zod';
import type { CustomRule } from './entities/rules';
import type { AonDraft, MonsterDraft } from './rules/aonParse';
import { TREASURE_BANDS, TREASURE_TYPES } from './rules/treasure';
import { RULES_KINDS, type RulesBook, type RulesHit, type RulesKind, type RulesRecord, type RulesStatus } from './rules/types';

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

const RulesKindSchema = z.enum(RULES_KINDS);
const TreasureBandSchema = z.enum(TREASURE_BANDS.map((b) => b.id) as [string, ...string[]]);
const TreasureTypeSchema = z.enum(TREASURE_TYPES);

export const rpcArgs = {
  'snapshots.list': z.object({}),
  'snapshots.create': z.object({ label: z.string().trim().max(80).optional() }),
  'snapshots.restore': z.object({ id: z.number().int().positive() }),
  // Epic 11: rules pack search, lookup, treasure generation and on-demand AoN import.
  'rules.status': z.object({}),
  'rules.books': z.object({}),
  'rules.search': z.object({
    kind: RulesKindSchema.optional(),
    q: z.string().max(120).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    /** GM-only: ignore room allowedSources when browsing. */
    allSources: z.boolean().optional(),
  }),
  'rules.get': z.object({
    kind: RulesKindSchema,
    key: z.string().min(1).max(160).optional(),
    name: z.string().min(1).max(160).optional(),
    customId: z.string().min(1).max(64).optional(),
  }),
  'rules.rollTreasure': z.object({
    band: TreasureBandSchema.optional(),
    type: TreasureTypeSchema.optional(),
    slot: z.string().max(40).optional(),
    count: z.number().int().min(1).max(10).optional(),
    allSources: z.boolean().optional(),
  }),
  'rules.fetchAon': z.object({
    /** Either a full allowlisted aonprd.com URL, or `kind` + `name`. */
    url: z.string().trim().max(500).optional(),
    kind: z.enum(['spell', 'feat', 'trait', 'weapon', 'armor', 'equipment', 'magicWeapon', 'magicArmor', 'wondrous', 'ring', 'rod', 'staff', 'monster']).optional(),
    name: z.string().trim().min(1).max(200).optional(),
  }),
};

export interface RulesLookupResult {
  record: RulesRecord | null;
  custom: CustomRule | null;
}

export interface AonFetchResult {
  url: string;
  cached: boolean;
  pageKind: 'monster' | 'spell' | 'feat' | 'item' | 'other';
  draft: AonDraft | null;
  monster: MonsterDraft | null;
}

export interface RpcResults {
  'snapshots.list': SnapshotInfo[];
  'snapshots.create': SnapshotInfo;
  'snapshots.restore': null;
  'rules.status': RulesStatus;
  'rules.books': RulesBook[];
  'rules.search': RulesHit[];
  'rules.get': RulesLookupResult;
  'rules.rollTreasure': { items: { key: string; name: string; cost: number | null; cl: number | null; slot: string | null; source: string; loot: import('./rules/treasure').TreasureLoot }[] };
  'rules.fetchAon': AonFetchResult;
}

export type RpcOp = keyof typeof rpcArgs;
export type RpcArgs<K extends RpcOp> = z.input<(typeof rpcArgs)[K]>;
export type { RulesKind };
