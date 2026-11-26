import type { SnapshotInfo } from '@vtt/shared';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface SnapshotPolicy {
  /** Take an automatic snapshot when the newest one is at least this old (and the room changed). */
  autoIntervalMs: number;
  /** Keep every automatic snapshot this recent. */
  keepAllForMs: number;
  /** After that, keep the newest snapshot of each day up to this age; delete older ones. */
  keepDailyForMs: number;
}

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  autoIntervalMs: HOUR,
  keepAllForMs: 2 * DAY,
  keepDailyForMs: 30 * DAY,
};

export function shouldAutoSnapshot(newest: SnapshotInfo | undefined, now: number, policy: SnapshotPolicy): boolean {
  return !newest || now - newest.createdAt >= policy.autoIntervalMs;
}

/**
 * Ids of snapshots to delete. Manual snapshots are kept forever; everything
 * else is thinned to all-recent, then daily, then gone.
 */
export function snapshotsToPrune(snapshots: SnapshotInfo[], now: number, policy: SnapshotPolicy): number[] {
  const prune: number[] = [];
  const keptDays = new Set<number>();
  const newestFirst = [...snapshots].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  for (const s of newestFirst) {
    if (s.reason === 'manual') continue;
    const age = now - s.createdAt;
    if (age <= policy.keepAllForMs) continue;
    if (age <= policy.keepDailyForMs) {
      const day = Math.floor(s.createdAt / DAY);
      if (!keptDays.has(day)) {
        keptDays.add(day);
        continue;
      }
    }
    prune.push(s.id);
  }
  return prune;
}
