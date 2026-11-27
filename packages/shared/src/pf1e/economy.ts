/**
 * PF1e per-turn action economy.
 *
 * Turn state is stored per combatant together with the "window" it belongs
 * to: the round in which that combatant's most recent turn started. When the
 * window moves on (their next turn starts) the stored state is simply stale
 * and reads as a fresh turn, so nothing has to hook into turn advancement.
 */
import type { Draft } from 'immer';
import type { Pf1TurnState } from '../entities/pf1e';
import type { GameState } from '../state';
import type { ActionCost } from './actions';
import { computeCharacterStats } from './engine';
import { featKey, normalizeName } from './rules';

export interface EffectiveTurn {
  /** Turn state for the current window (fresh if nothing recorded yet). */
  turn: Pf1TurnState;
  /** It is this combatant's turn right now. */
  isTurn: boolean;
  /** Hasn't acted yet in the first round, or has the Flat-footed condition. */
  flatFooted: boolean;
  /** Swift action unavailable this turn because of an immediate action taken since the last turn. */
  swiftLocked: boolean;
  aooMax: number;
  combatReflexes: boolean;
}

export const freshTurn = (window: number): Pf1TurnState => ({
  window,
  standard: false,
  move: false,
  fullRound: false,
  swift: false,
  fiveFoot: false,
  moved: false,
  aoo: 0,
  immediateLock: null,
});

/** Round in which this combatant's latest turn started (0 = not yet). */
export function turnWindow(state: GameState, combatantId: string): number {
  const { combat } = state;
  if (!combat.active) return 0;
  const order = combat.combatants.map((c) => c.id);
  const mine = order.indexOf(combatantId);
  const current = order.indexOf(combat.currentId ?? '');
  if (mine === -1 || current === -1) return 0;
  return mine <= current ? combat.round : combat.round - 1;
}

/** The character linked to a combatant's token, if any. */
export function characterForCombatant(state: GameState, combatantId: string) {
  const cb = state.combat.combatants.find((c) => c.id === combatantId);
  return cb?.tokenId ? Object.values(state.characters).find((ch) => ch.tokenId === cb.tokenId) : undefined;
}

export function effectiveTurn(state: GameState, combatantId: string): EffectiveTurn {
  const { combat } = state;
  const window = turnWindow(state, combatantId);
  const stored = state.pf1eTurns[combatantId];
  // An immediate action taken off-turn uses up the swift action of the turn after it:
  // a fresh turn that inherits such a lock starts with its swift already spent.
  const inheritsLock = !!stored && stored.window !== window && stored.immediateLock === window && window > 0;
  const turn = stored && stored.window === window ? stored : { ...freshTurn(window), swift: inheritsLock };
  const cb = combat.combatants.find((c) => c.id === combatantId);
  const token = cb?.tokenId ? state.tokens[cb.tokenId] : undefined;
  const character = characterForCombatant(state, combatantId);

  let combatReflexes = false;
  let aooMax = 1;
  let hasUncannyDodge = false;
  if (character) {
    const allFeats = [...character.build.abilities.map((a) => a.key), ...character.build.legacyFeats, ...character.build.virtualFeats];
    combatReflexes = allFeats.some((n) => featKey(n) === 'combatreflexes');
    if (combatReflexes) aooMax = Math.max(1, 1 + computeCharacterStats(character).abilities.DEX.mod);
    const classLvl = (...keys: string[]) =>
      character.build.classes.filter((k) => keys.includes(normalizeName(k.name))).reduce((s, k) => s + k.level, 0);
    hasUncannyDodge =
      classLvl('barbarian', 'barbarianunchained', 'unchainedbarbarian', 'bloodrager') >= 2 ||
      classLvl('rogue', 'rogueunchained', 'unchainedrogue', 'skald') >= 4 ||
      allFeats.some((n) => /uncanny\s*dodge/i.test(n));
  }
  const swiftLocked = inheritsLock;

  return {
    turn,
    isTurn: combat.active && combat.currentId === combatantId,
    flatFooted: (combat.active && window === 0 && !hasUncannyDodge) || !!token?.conditions.some((c) => c.toLowerCase() === 'flat-footed'),
    swiftLocked,
    aooMax,
    combatReflexes,
  };
}

/** Why an action with this cost can't be taken now, or true if it can. */
export function canSpend(e: EffectiveTurn, cost: ActionCost, movement = false): true | string {
  const t = e.turn;
  const moveBlocked = movement && t.fiveFoot ? 'You already took a 5-foot step this turn' : null;
  switch (cost) {
    case 'standard':
      if (!e.isTurn) return 'Only on your turn';
      if (t.fullRound) return 'You already took a full-round action';
      if (t.standard) return 'Standard action already used';
      return moveBlocked ?? true;
    case 'move':
      if (!e.isTurn) return 'Only on your turn';
      if (t.fullRound) return 'You already took a full-round action';
      if (t.move && t.standard) return 'No move action left';
      return moveBlocked ?? true;
    case 'fullRound':
      if (!e.isTurn) return 'Only on your turn';
      if (t.fullRound || t.standard || t.move) return 'A full-round action needs your whole turn';
      return moveBlocked ?? true;
    case 'swift':
      if (!e.isTurn) return 'Only on your turn';
      if (t.swift || e.swiftLocked) return 'Swift action already used (immediate actions use it too)';
      return true;
    case 'immediate':
      if (e.flatFooted) return 'Not while flat-footed';
      if (e.isTurn) return t.swift || e.swiftLocked ? 'Swift action already used (immediate actions use it too)' : true;
      if (t.immediateLock !== null && t.immediateLock > t.window) return 'You already used an immediate action since your last turn';
      return true;
    case 'fiveFoot':
      if (!e.isTurn) return 'Only on your turn';
      if (t.fiveFoot) return 'Only one 5-foot step per turn';
      if (t.moved) return 'Not after moving this turn';
      return true;
    case 'aoo':
      if (e.flatFooted && !e.combatReflexes) return 'Flat-footed creatures can’t make attacks of opportunity';
      if (t.aoo >= e.aooMax) return `No attacks of opportunity left this round (${e.aooMax})`;
      return true;
    default:
      return true;
  }
}

/** Record spending an action (call only after canSpend passed). */
export function applySpend(t: Draft<Pf1TurnState>, e: EffectiveTurn, cost: ActionCost, movement = false) {
  switch (cost) {
    case 'standard':
      t.standard = true;
      break;
    case 'move':
      if (!t.move) t.move = true;
      else t.standard = true; // a standard action can be traded for a second move
      break;
    case 'fullRound':
      t.fullRound = t.standard = t.move = true;
      break;
    case 'swift':
      t.swift = true;
      break;
    case 'immediate':
      if (e.isTurn) t.swift = true;
      else t.immediateLock = t.window + 1;
      break;
    case 'fiveFoot':
      t.fiveFoot = true;
      break;
    case 'aoo':
      t.aoo += 1;
      break;
  }
  if (movement) t.moved = true;
}
