/**
 * Persisted rooms carry a `schemaVersion`. When the state shape changes,
 * bump CURRENT_SCHEMA_VERSION in state.ts and add a step here that upgrades
 * the previous version's raw JSON. Steps run in order on load.
 */
import { seedBio, splitDmNotes } from './pf1e/bio';
import { seedInventory } from './pf1e/inventory';
import { PcgenCharacterSchema } from './pcgen/schema';
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
  // Epic 4: VTT-owned inventory seeded from each character's imported gear; loot can be stowed in it.
  6: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    const loot = (raw.loot ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 7,
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => [id, { ...c, inventory: seedInventory(PcgenCharacterSchema.parse(c.build)) }]),
      ),
      loot: Object.fromEntries(Object.entries(loot).map(([id, l]) => [id, { ...l, stowed: false }])),
    };
  },
  // Epic 5: per-skill sheet overrides.
  7: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 8,
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => [id, { ...c, sheet: { skills: {}, ...(c.sheet as object) } }]),
      ),
    };
  },
  // Epic 6: combat toggles and custom resource pools.
  8: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 9,
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => [
          id,
          { ...c, sheet: { customPools: [], ...(c.sheet as object) }, runtime: { toggles: {}, ...(c.runtime as object) } },
        ]),
      ),
    };
  },
  // Epic 7: prepared spells (empty = the .pcg's prepared book) and per-class casting settings.
  9: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 10,
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => [
          id,
          { ...c, sheet: { spellcasting: {}, ...(c.sheet as object) }, runtime: { prepared: {}, ...(c.runtime as object) } },
        ]),
      ),
    };
  },
  // Epic 8: buffs, character conditions (mirroring a linked token's) and condition timers on tokens.
  10: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    const tokens = (raw.tokens ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 11,
      tokens: Object.fromEntries(Object.entries(tokens).map(([id, t]) => [id, { conditionRounds: {}, ...t }])),
      combat: { ticks: { round: 0, ids: [] }, ...(raw.combat as object) },
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => {
          const token = typeof c.tokenId === 'string' ? tokens[c.tokenId] : undefined;
          const conditions = Array.isArray(token?.conditions) ? token.conditions : [];
          return [id, { ...c, runtime: { buffs: [], conditions, ...(c.runtime as object) } }];
        }),
      ),
    };
  },
  // Epic 9: companion links (MASTER/FOLLOWER) between characters.
  11: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 12,
      characters: Object.fromEntries(Object.entries(characters).map(([id, c]) => [id, { companion: null, ...c }])),
    };
  },
  // Epic 10: VTT-owned bio seeded from the .pcg; GM-only notes move out of the shared build into bio.dmNotes.
  12: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 13,
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => {
          const { build, dmNotes } = splitDmNotes(PcgenCharacterSchema.parse(c.build));
          return [id, { ...c, build, bio: seedBio(build, dmNotes) }];
        }),
      ),
    };
  },
  // Epic 11: allowed books, custom rules catalog, treasure true properties, item trade-good/rule keys, stat-block attacks.
  13: (raw) => {
    const characters = (raw.characters ?? {}) as Record<string, Record<string, unknown>>;
    const loot = (raw.loot ?? {}) as Record<string, Record<string, unknown>>;
    return {
      ...raw,
      schemaVersion: 14,
      rules: { allowedSources: null },
      customRules: {},
      loot: Object.fromEntries(
        Object.entries(loot).map(([id, l]) => [id, { trueName: '', secretValue: '', cl: null, magicDetected: false, ...l }]),
      ),
      characters: Object.fromEntries(
        Object.entries(characters).map(([id, c]) => {
          const inv = (c.inventory ?? {}) as Record<string, unknown>;
          const items = Array.isArray(inv.items) ? (inv.items as Record<string, unknown>[]) : [];
          return [
            id,
            {
              ...c,
              sheet: { statAttacks: [], ...(c.sheet as object) },
              inventory: { ...inv, items: items.map((i) => ({ tradeGood: false, ruleKey: null, ...i })) },
            },
          ];
        }),
      ),
    };
  },
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
