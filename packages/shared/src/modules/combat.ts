/**
 * Turn tracker. One encounter per room. Combatants are usually linked to a
 * token; whoever controls the token controls the combatant (rolling and
 * editing initiative, ending their turn, delaying).
 */
import { z } from 'zod';
import type { Draft } from 'immer';
import { defineAction, type ActionMeta, type AuthContext, type AuthResult } from '../actions/define';
import { canControlToken, isGm, requireGm } from '../actions/auth';
import { rollDice, RollResultSchema } from '../dice';
import { CombatantSchema, IdSchema, type Combat, type Combatant, type GameState, type User } from '../state';
import { pushMessage } from './chat';
import { mirrorTokenConditions } from './pf1e/characters';
import { newId } from '../util';

// ---------------------------------------------------------------- turn-start hooks

export interface TurnStart {
  /** Combatant whose turn just started (null if the order is empty). */
  combatantId: string | null;
  /** The turn order wrapped around: a new round began. */
  newRound: boolean;
  meta: ActionMeta;
}

/**
 * Things that happen when a turn starts (round-based durations count down).
 * Runs inside combat/next's reducer, so hooks must be deterministic and only
 * use the state each client has (a client missing a hidden token or an
 * unshared character simply skips it; the redactors hide the rest).
 */
export type TurnStartHook = (draft: Draft<GameState>, turn: TurnStart) => void;
const turnStartHooks: TurnStartHook[] = [];
export function onTurnStart(hook: TurnStartHook) {
  turnStartHooks.push(hook);
}

/** A chat id that every client derives identically for a system notice. */
export function noticeId(meta: ActionMeta, key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return `n-${meta.ts.toString(36)}-${h.toString(36)}`;
}

/** User ids of the GMs plus the given users, for a private notice. */
export function noticeRecipients(state: Pick<GameState, 'users'>, userIds: (string | null | undefined)[]): string[] {
  const gms = Object.values(state.users).filter((u) => isGm(u)).map((u) => u.id);
  return [...new Set([...userIds.filter((x): x is string => !!x), ...gms])].filter((id) => !!state.users[id]).slice(0, 20);
}

/** Token condition timers: count down at the start of the token's turn; at 0 the condition ends. */
onTurnStart((draft, { combatantId, meta }) => {
  const cb = draft.combat.combatants.find((c) => c.id === combatantId);
  const token = cb?.tokenId ? draft.tokens[cb.tokenId] : undefined;
  if (!token) return;
  const ended: string[] = [];
  for (const [name, rounds] of Object.entries(token.conditionRounds)) {
    if (rounds > 1) token.conditionRounds[name] = rounds - 1;
    else {
      delete token.conditionRounds[name];
      token.conditions = token.conditions.filter((c) => c !== name);
      ended.push(name);
    }
  }
  if (!ended.length) return;
  mirrorTokenConditions(draft, token.id);
  pushMessage(draft.chat, {
    id: noticeId(meta, `cond|${token.id}|${ended.join('|')}`),
    userId: 'system',
    ts: meta.ts,
    text: `⏱ ${token.name.trim() || 'Token'}: ${ended.join(', ')} ended`,
    whisper: { mode: 'whisper', to: noticeRecipients(draft, token.ownerIds) },
  });
});

export function canControlCombatant(state: Pick<GameState, 'tokens'>, user: User, c: Combatant): boolean {
  if (isGm(user)) return true;
  const token = c.tokenId ? state.tokens[c.tokenId] : undefined;
  return !!token && canControlToken(user, token);
}

/** Hidden if the GM hid the entry, or if its token is hidden. */
export function isCombatantHidden(state: Pick<GameState, 'tokens'>, c: Combatant): boolean {
  return c.hidden || (!!c.tokenId && !!state.tokens[c.tokenId]?.hidden);
}

/** Display name: the linked token's current name, falling back to the stored one. */
export function combatantName(state: Pick<GameState, 'tokens'>, c: Combatant): string {
  const token = c.tokenId ? state.tokens[c.tokenId] : undefined;
  return token?.name.trim() || c.name;
}

/** Run turn-start duration hooks once per combatant per round (safe against prev/next or delay). */
function tickCurrentTurn(draft: Draft<GameState>, meta: ActionMeta, allowNewRound: boolean) {
  const combat = draft.combat;
  if (!combat.active) return;
  const newRound = allowNewRound && combat.round > combat.ticks.round;
  if (newRound) combat.ticks = { round: combat.round, ids: [] };
  const id = combat.currentId;
  const fresh = combat.round === combat.ticks.round && !!id && !combat.ticks.ids.includes(id);
  if (fresh) combat.ticks.ids.push(id!);
  if (!fresh && !newRound) return;
  for (const hook of turnStartHooks) hook(draft, { combatantId: fresh ? id : null, newRound, meta });
}

/** Remove a combatant, passing the turn on if it was theirs and dropping its PF1e turn state. */
export function removeCombatant(draft: Draft<GameState>, id: string) {
  const { combat } = draft;
  const idx = combat.combatants.findIndex((c) => c.id === id);
  if (idx === -1) return;
  if (combat.currentId === id) {
    const next = combat.combatants[idx + 1] ?? combat.combatants[0];
    combat.currentId = next && next.id !== id ? next.id : null;
  }
  combat.combatants.splice(idx, 1);
  delete draft.pf1eTurns[id];
}

function requireCombatant(ctx: AuthContext, id: string): AuthResult {
  const c = ctx.state.combat.combatants.find((x) => x.id === id);
  if (!c) return 'Not in the turn order';
  return canControlCombatant(ctx.state, ctx.user, c) || "You don't control that combatant";
}

/** Highest initiative first; ties broken by modifier, then name. Unrolled go last. */
export function compareCombatants(a: Combatant, b: Combatant): number {
  if (a.initiative === null || b.initiative === null) {
    return a.initiative === null ? (b.initiative === null ? a.name.localeCompare(b.name) : 1) : -1;
  }
  return b.initiative - a.initiative || b.modifier - a.modifier || a.name.localeCompare(b.name);
}

function sortCombat(combat: Draft<Combat>) {
  combat.combatants.sort(compareCombatants);
}

/** Move the turn; returns whether a new round began. */
function advance(combat: Draft<Combat>, step: 1 | -1): boolean {
  const list = combat.combatants;
  if (!list.length) {
    combat.currentId = null;
    return false;
  }
  const idx = list.findIndex((c) => c.id === combat.currentId);
  if (idx === -1) {
    combat.currentId = list[0]!.id;
    return false;
  }
  let next = idx + step;
  let newRound = false;
  if (next >= list.length) {
    next = 0;
    combat.round += 1;
    newRound = true;
  } else if (next < 0) {
    next = list.length - 1;
    combat.round = Math.max(1, combat.round - 1);
  }
  combat.currentId = list[next]!.id;
  return newRound;
}

const CombatantChangesSchema = CombatantSchema.pick({ name: true, initiative: true, modifier: true, hidden: true }).partial();

export const combatActions = {
  add: defineAction('combat/add', z.object({ combatant: CombatantSchema }), {
    authorize(ctx, { combatant }) {
      if (ctx.state.combat.combatants.some((c) => c.id === combatant.id)) return 'Already in the turn order';
      if (combatant.tokenId && ctx.state.combat.combatants.some((c) => c.tokenId === combatant.tokenId))
        return 'That token is already in the turn order';
      if (isGm(ctx.user)) return true;
      if (combatant.hidden) return 'Only the GM can add hidden combatants';
      const token = combatant.tokenId ? ctx.state.tokens[combatant.tokenId] : undefined;
      if (!token || !canControlToken(ctx.user, token)) return 'You can only add your own tokens';
      return true;
    },
    apply(draft, { combatant }) {
      const combat = draft.combat;
      if (combat.combatants.some((c) => c.id === combatant.id)) return;
      if (combat.active && combatant.initiative !== null) {
        // Slot into place without disturbing the current order.
        const at = combat.combatants.findIndex((c) => compareCombatants(combatant, c) < 0);
        combat.combatants.splice(at === -1 ? combat.combatants.length : at, 0, combatant);
      } else {
        combat.combatants.push(combatant);
        if (!combat.active) sortCombat(combat);
      }
    },
  }),

  remove: defineAction('combat/remove', z.object({ id: IdSchema }), {
    authorize: (ctx, { id }) => requireCombatant(ctx, id),
    apply(draft, { id }, meta) {
      const wasCurrent = draft.combat.active && draft.combat.currentId === id;
      removeCombatant(draft, id);
      if (wasCurrent && draft.combat.currentId) tickCurrentTurn(draft, meta, false);
    },
  }),

  update: defineAction('combat/update', z.object({ id: IdSchema, changes: CombatantChangesSchema }), {
    authorize(ctx, { id, changes }) {
      const ok = requireCombatant(ctx, id);
      if (ok !== true) return ok;
      if (changes.hidden !== undefined && !isGm(ctx.user)) return 'Only the GM can hide combatants';
      return true;
    },
    apply(draft, { id, changes }) {
      const c = draft.combat.combatants.find((x) => x.id === id);
      if (!c) return;
      Object.assign(c, changes);
      if (!draft.combat.active) sortCombat(draft.combat);
    },
  }),

  /** Roll 1d20 + modifier for the given combatants (server-side). */
  rollInitiative: defineAction(
    'combat/rollInitiative',
    z.object({
      ids: z.array(IdSchema).min(1).max(200),
      /** Filled in by the server. */
      results: z.array(z.object({ id: IdSchema, chatId: IdSchema, roll: RollResultSchema })).optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { ids }) {
        for (const id of ids) {
          const ok = requireCombatant(ctx, id);
          if (ok !== true) return ok;
        }
        return true;
      },
      prepare(ctx, { ids }) {
        const results = ids.flatMap((id) => {
          const c = ctx.state.combat.combatants.find((x) => x.id === id);
          if (!c) return [];
          const expr = `1d20${c.modifier >= 0 ? '+' : ''}${c.modifier}`;
          return [{ id, chatId: newId(), roll: rollDice(expr, ctx.random) }];
        });
        return { ids, results };
      },
      apply(draft, { results }, meta) {
        if (!results) return;
        const combat = draft.combat;
        for (const r of results) {
          const c = combat.combatants.find((x) => x.id === r.id);
          if (!c) continue;
          c.initiative = r.roll.total;
          pushMessage(draft.chat, {
            id: r.chatId,
            userId: meta.userId,
            ts: meta.ts,
            text: `${combatantName(draft, c)}: initiative`,
            roll: r.roll,
            // Hidden combatants' rolls are GM-only.
            ...(isCombatantHidden(draft, c) ? { whisper: { mode: 'gm' as const, to: [] } } : {}),
          });
        }
        if (!combat.active) sortCombat(combat);
      },
    },
  ),

  sort: defineAction('combat/sort', z.object({}), {
    authorize: requireGm,
    apply(draft) {
      sortCombat(draft.combat);
    },
  }),

  start: defineAction('combat/start', z.object({}), {
    authorize: (ctx) => (requireGm(ctx) === true ? ctx.state.combat.combatants.length > 0 || 'Add combatants first' : requireGm(ctx)),
    apply(draft) {
      const combat = draft.combat;
      sortCombat(combat);
      combat.active = true;
      combat.round = 1;
      combat.currentId = combat.combatants[0]?.id ?? null;
      // Durations don't tick when combat starts; the first turn counts as already started.
      combat.ticks = { round: 1, ids: combat.currentId ? [combat.currentId] : [] };
      draft.pf1eTurns = {};
    },
  }),

  /** End the current turn. The GM, or whoever controls the current combatant. */
  next: defineAction('combat/next', z.object({}), {
    authorize(ctx) {
      const { combat } = ctx.state;
      if (!combat.active) return 'Combat has not started';
      if (isGm(ctx.user)) return true;
      const current = combat.combatants.find((c) => c.id === combat.currentId);
      return (!!current && canControlCombatant(ctx.state, ctx.user, current)) || "It's not your turn";
    },
    apply(draft, _payload, meta) {
      const combat = draft.combat;
      if (!combat.active) return;
      advance(combat, 1);
      // Durations count down as turns start, once per combatant per round: stepping back
      // with prev and forward again doesn't tick twice (nor does prev give rounds back).
      tickCurrentTurn(draft, meta, true);
    },
  }),

  prev: defineAction('combat/prev', z.object({}), {
    authorize: requireGm,
    apply(draft) {
      if (draft.combat.active) advance(draft.combat, -1);
    },
  }),

  /**
   * Move a combatant to just before `beforeId` (null = end). Delaying the
   * current combatant passes the turn to whoever is next.
   */
  move: defineAction('combat/move', z.object({ id: IdSchema, beforeId: IdSchema.nullable() }), {
    authorize: (ctx, { id }) => requireCombatant(ctx, id),
    apply(draft, { id, beforeId }, meta) {
      const combat = draft.combat;
      const from = combat.combatants.findIndex((c) => c.id === id);
      if (from === -1 || id === beforeId) return;
      const wasCurrent = combat.active && combat.currentId === id;
      if (wasCurrent) {
        const next = combat.combatants[from + 1];
        combat.currentId = next ? next.id : (combat.combatants[0]?.id ?? null);
      }
      const [moved] = combat.combatants.splice(from, 1);
      const to = beforeId ? combat.combatants.findIndex((c) => c.id === beforeId) : -1;
      combat.combatants.splice(to === -1 ? combat.combatants.length : to, 0, moved!);
      if (wasCurrent && combat.currentId && combat.currentId !== id) tickCurrentTurn(draft, meta, false);
    },
  }),

  end: defineAction('combat/end', z.object({ clear: z.boolean() }), {
    authorize: requireGm,
    apply(draft, { clear }) {
      draft.combat.active = false;
      draft.combat.round = 0;
      draft.combat.currentId = null;
      draft.combat.ticks = { round: 0, ids: [] };
      draft.pf1eTurns = {};
      if (clear) draft.combat.combatants = [];
    },
  }),
};
