/** What a linked token should look like, derived from its character. */
import type { Character } from '../entities/pf1e';
import type { LightEmission } from '../entities/vision';
import type { GameState, Token } from '../state';
import { computeCharacterStats } from './engine';
import { litLight } from './inventory';
import { SIZE_CELLS } from './rules';

export interface TokenSync {
  name: string;
  hp: NonNullable<Token['hp']>;
  /** Grid cells. */
  darkvision: number;
  /** Grid cells. */
  size: number;
  /**
   * Carried light from lit torches/lanterns (null = none lit). Absent when the
   * character has no light sources, so a light set on the token by hand stays.
   */
  light?: LightEmission | null;
}

/** Warm torchlight. */
export const CARRIED_LIGHT_COLOR = '#ffd28a';

/**
 * Values to push onto a linked token. While linked, the token's current and
 * temp HP are the live values (the map bar, damage buttons and sheet all edit
 * the same thing); syncing only updates max HP, keeping a full-health token
 * at full when max HP grows.
 */
export function tokenSyncFor(state: Pick<GameState, 'scenes'>, c: Character, token: Token | undefined): TokenSync {
  const stats = computeCharacterStats(c);
  const rawUnits = token ? state.scenes[token.sceneId]?.grid.unitsPerCell : undefined;
  const unitsPerCell = rawUnits && rawUnits > 0 ? rawUnits : 5;
  const max = Math.min(100000, Math.max(1, stats.hp.total));
  const prev = token?.hp;
  let value: number;
  if (prev) value = prev.value >= prev.max ? max : Math.min(prev.value, max);
  else value = Math.min(c.runtime.hp?.current ?? max, max);
  value = Math.max(-100000, Math.min(100000, value));
  const sync: TokenSync = {
    name: c.name.slice(0, 60),
    hp: { value, max, temp: prev?.temp ?? c.runtime.hp?.temp ?? 0 },
    darkvision: Math.min(200, Math.max(0, Math.round(stats.senses.darkvision / unitsPerCell))),
    size: SIZE_CELLS[stats.size],
  };
  if (c.inventory.items.some((i) => i.light)) {
    const lit = litLight(c.inventory);
    sync.light = lit
      ? {
          bright: Math.min(200, Math.round(lit.bright / unitsPerCell)),
          dim: Math.min(400, Math.max(Math.round(lit.bright / unitsPerCell), Math.round(lit.dim / unitsPerCell))),
          color: token?.light?.color ?? CARRIED_LIGHT_COLOR,
        }
      : null;
  }
  return sync;
}

/** The character's live HP: from its linked token if there is one, else its own runtime record. */
export function characterHp(state: Pick<GameState, 'tokens'>, c: Character, maxHp: number): { current: number; temp: number; nonlethal: number; fromToken: boolean } {
  const token = c.tokenId ? state.tokens[c.tokenId] : undefined;
  if (token?.hp) return { current: token.hp.value, temp: token.hp.temp, nonlethal: c.runtime.hp?.nonlethal ?? 0, fromToken: true };
  return { current: c.runtime.hp?.current ?? maxHp, temp: c.runtime.hp?.temp ?? 0, nonlethal: c.runtime.hp?.nonlethal ?? 0, fromToken: false };
}
