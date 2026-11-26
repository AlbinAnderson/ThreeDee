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
  2: (raw) => {
    const scenes = (raw.scenes ?? {}) as Record<string, Record<string, unknown>>;
    const tokens = (raw.tokens ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 3,
      scenes: Object.fromEntries(
        Object.entries(scenes).map(([id, s]) => [
          id,
          { ...s, fog: { enabled: false, ops: [] }, vision: { enabled: false, dark: false } },
        ]),
      ),
      tokens: Object.fromEntries(
        Object.entries(tokens).map(([id, t]) => [
          id,
          { ...t, hp: null, hpVisible: false, conditions: [], darkvision: 0, light: null },
        ]),
      ),
      walls: {},
      lights: {},
      templates: {},
      combat: { active: false, round: 0, currentId: null, combatants: [] },
      handouts: {},
      macros: {},
      audio: {},
      tables: {},
      decks: {},
    };
  },
  3: (raw) => ({ ...raw, schemaVersion: 4, characters: {} }),
  4: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 5,
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => [
          id,
          {
            ...c,
            sheet: { racialChoice: null, classChassis: {}, armorBonus: null, shieldBonus: null, maxDex: null, size: null, speed: null, darkvision: null, misc: {} },
            runtime: { abilityDamage: {}, abilityDrain: {}, abilityTemp: {}, ...(c.runtime as object) },
          },
        ]),
      ),
    };
  },
  5: (raw) => ({ ...raw, schemaVersion: 6, pf1eTurns: {} }),
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
