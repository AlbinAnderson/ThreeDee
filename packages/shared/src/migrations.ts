/**
 * Persisted rooms carry a `schemaVersion`. When the state shape changes,
 * bump CURRENT_SCHEMA_VERSION in state.ts and add a step here that upgrades
 * the previous version's raw JSON. Steps run in order on load.
 */
import { CURRENT_SCHEMA_VERSION, GameStateSchema, type GameState } from './state';

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades version n -> n + 1. */
const migrations: Record<number, Migration> = {
  1: (raw) => ({ ...raw, schemaVersion: 2, drawings: {}, notes: {}, loot: {} }),
};

export function migrateState(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object') throw new Error('Room data is not an object');
  let data = raw as Record<string, unknown>;
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema version ${version}`);
    data = step(data);
    version++;
  }
  return GameStateSchema.parse({ ...data, schemaVersion: version });
}
