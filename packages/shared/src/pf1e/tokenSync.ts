/** What a linked token should look like, derived from its character. */
import type { Character } from '../entities/pf1e';
import type { GameState, Token } from '../state';
import { computeCharacterStats } from './engine';
import { SIZE_CELLS } from './rules';

export interface TokenSync {
  name: string;
  hp: NonNullable<Token['hp']>;
  /** Grid cells. */
  darkvision: number;
  /** Grid cells. */
  size: number;
}

/**
 * Values to push onto a linked token. While linked, the token's current and
 * temp HP are the live values (the map bar, damage buttons and sheet all edit
 * the same thing); syncing only updates max HP, keeping a full-health token
 * at full when max HP grows.
 */
export function tokenSyncFor(state: GameState, c: Character, token: Token | undefined): TokenSync {
  const stats = computeCharacterStats(c);
  const unitsPerCell = (token && state.scenes[token.sceneId]?.grid.unitsPerCell) || 5;
  const max = Math.max(1, stats.hp.total);
  const prev = token?.hp;
  let value: number;
  if (prev) value = prev.value >= prev.max ? max : Math.min(prev.value, max);
  else value = Math.min(c.runtime.hp?.current ?? max, max);
  return {
    name: c.name,
    hp: { value, max, temp: prev?.temp ?? c.runtime.hp?.temp ?? 0 },
    darkvision: Math.round(stats.senses.darkvision / unitsPerCell),
    size: SIZE_CELLS[stats.size],
  };
}

/** The character's live HP: from its linked token if there is one, else its own runtime record. */
export function characterHp(state: Pick<GameState, 'tokens'>, c: Character, maxHp: number): { current: number; temp: number; nonlethal: number; fromToken: boolean } {
  const token = c.tokenId ? state.tokens[c.tokenId] : undefined;
  if (token?.hp) return { current: token.hp.value, temp: token.hp.temp, nonlethal: c.runtime.hp?.nonlethal ?? 0, fromToken: true };
  return { current: c.runtime.hp?.current ?? maxHp, temp: c.runtime.hp?.temp ?? 0, nonlethal: c.runtime.hp?.nonlethal ?? 0, fromToken: false };
}
