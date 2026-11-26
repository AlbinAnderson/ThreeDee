/**
 * PF1e actions in play: spend a turn action (and class resource), announce it
 * in chat, reset a turn, and reset daily resource uses.
 */
import { z } from 'zod';
import { defineAction, type AuthContext, type AuthResult, type Redactor } from '../../actions/define';
import { isGm } from '../../actions/auth';
import { classActionSetsFor, classSetForAction, COST_LABEL, lookupPf1Action, type Pf1Action } from '../../pf1e/actions';
import { applySpend, canSpend, characterForCombatant, effectiveTurn, freshTurn, turnWindow } from '../../pf1e/economy';
import { computeCharacterStats } from '../../pf1e/engine';
import { resourceKey, resourceMax } from '../../pf1e/resources';
import { ChatWhisperSchema, IdSchema, type Character, type GameState } from '../../state';
import { canSeeMessage, pushMessage } from '../chat';
import { canControlCombatant, combatantName, isCombatantHidden } from '../combat';
import { canManageCharacter } from './characters';

const PROVOKES_LABEL = { yes: 'provokes AoO', no: 'no AoO', varies: 'AoO varies', ranged: 'ranged provokes' } as const;

/** Class actions need a character with that class, and resource actions enough uses left. */
function classCheck(c: Character | undefined, action: Pf1Action): AuthResult {
  const set = classSetForAction(action.id);
  if (!set) return true;
  if (!c) return `Needs a character with the ${set.className} class`;
  const entry = classActionSetsFor(c.build.classes).find((x) => x.set === set);
  if (!entry) return `${c.name} doesn’t have the ${set.className} class`;
  if (!action.resource) return true;
  const def = set.resources.find((r) => r.id === action.resource)!;
  const used = c.runtime.uses[resourceKey(set, def.id)] ?? 0;
  const max = resourceMax(c, def, entry.level);
  const cost = action.resourceCost ?? 1;
  return used + cost <= max || `No ${def.name} left (${used}/${max} ${def.unit} used${cost > 1 ? `, needs ${cost}` : ''})`;
}

function actor(state: GameState, combatantId: string | undefined, characterId: string | undefined) {
  const character = characterId ? state.characters[characterId] : combatantId ? characterForCombatant(state, combatantId) : undefined;
  const combatant = combatantId ? state.combat.combatants.find((c) => c.id === combatantId) : undefined;
  return { character, combatant };
}

function authorizeActor(ctx: AuthContext, combatantId: string | undefined, characterId: string | undefined): AuthResult {
  const { character, combatant } = actor(ctx.state, combatantId, characterId);
  if (combatantId && !combatant) return 'Not in the turn order';
  if (characterId && !character) return 'Character not found';
  if (combatant && characterId && (!combatant.tokenId || character?.tokenId !== combatant.tokenId))
    return 'Character is not linked to that combatant';
  if (combatant && !canControlCombatant(ctx.state, ctx.user, combatant)) return "You don't control that combatant";
  if (characterId && character && !canManageCharacter(ctx.user, character)) return "You don't control that character";
  if (!combatant && !character) return 'Choose a character or combatant';
  return true;
}

export const pf1eTurnActions = {
  /**
   * Take an action: in combat it spends the matching part of the turn; class
   * actions also spend their resource. Announced in chat.
   */
  act: defineAction(
    'pf1e/act',
    z.object({
      actionId: z.string().max(80),
      combatantId: IdSchema.optional(),
      characterId: IdSchema.optional(),
      chatId: IdSchema,
      /** Filled in by the server so clients who can't see an unshared character still render the same name. */
      who: z.string().max(80).optional(),
      /** Filled in by the server: hidden combatants' actions stay GM-only. */
      whisper: ChatWhisperSchema.optional(),
    }),
    {
      authorize(ctx, { actionId, combatantId, characterId }) {
        const action = lookupPf1Action(actionId);
        if (!action) return 'Unknown action';
        const ok = authorizeActor(ctx, combatantId, characterId);
        if (ok !== true) return ok;
        const { character } = actor(ctx.state, combatantId, characterId);
        const res = classCheck(character, action);
        if (res !== true) return res;
        if (combatantId && ctx.state.combat.active) {
          const spend = canSpend(effectiveTurn(ctx.state, combatantId), action.cost, action.movement);
          if (spend !== true) return spend;
        }
        return true;
      },
      prepare(ctx, payload) {
        const { character, combatant } = actor(ctx.state, payload.combatantId, payload.characterId);
        const who = character?.name ?? (combatant ? combatantName(ctx.state, combatant) : 'Someone');
        const hidden = !!combatant && isCombatantHidden(ctx.state, combatant);
        return {
          ...payload,
          who,
          whisper: hidden ? { mode: 'gm' as const, to: [] } : undefined,
        };
      },
      audience: (viewer, { whisper }, { meta }) => canSeeMessage(viewer, meta.userId, whisper),
      apply(draft, { actionId, combatantId, characterId, chatId, who: preparedWho, whisper }, meta) {
        const action = lookupPf1Action(actionId);
        if (!action) return;
        const state = draft as unknown as GameState;
        const { character, combatant } = actor(state, combatantId, characterId);

        if (combatantId && combatant && draft.combat.active) {
          const e = effectiveTurn(state, combatantId);
          const turn = { ...e.turn };
          applySpend(turn, e, action.cost, action.movement);
          draft.pf1eTurns[combatantId] = turn;
          // Forget turn state of combatants that left the turn order.
          for (const id of Object.keys(draft.pf1eTurns)) if (!draft.combat.combatants.some((c) => c.id === id)) delete draft.pf1eTurns[id];
        }

        const set = classSetForAction(action.id);
        const c = character ? draft.characters[character.id] : undefined;
        if (action.resource && set && c) {
          const key = resourceKey(set, action.resource);
          c.runtime.uses[key] = (c.runtime.uses[key] ?? 0) + (action.resourceCost ?? 1);
        }

        const who = preparedWho ?? character?.name ?? (combatant ? combatantName(state, combatant) : 'Someone');
        pushMessage(draft.chat, {
          id: chatId,
          userId: meta.userId,
          ts: meta.ts,
          text: '',
          ...(whisper ? { whisper } : {}),
          card: {
            title: `${who}: ${action.name}`.slice(0, 120),
            subtitle: `${action.costLabel ?? COST_LABEL[action.cost]} · ${PROVOKES_LABEL[action.provokes]}`,
            text: action.notes,
          },
        });
      },
    },
  ),

  /** Undo: give a combatant their whole turn back. */
  resetTurn: defineAction('pf1e/resetTurn', z.object({ combatantId: IdSchema }), {
    authorize(ctx, { combatantId }) {
      if (!ctx.state.combat.active) return 'Combat has not started';
      return authorizeActor(ctx, combatantId, undefined);
    },
    audience(viewer, { combatantId }, { state }) {
      const cb = state.combat.combatants.find((c) => c.id === combatantId);
      return isGm(viewer) || !cb || !isCombatantHidden(state, cb);
    },
    apply(draft, { combatantId }) {
      const window = turnWindow(draft as unknown as GameState, combatantId);
      draft.pf1eTurns[combatantId] = freshTurn(window);
    },
  }),

  /** Restore daily resources (after 8 hours of rest). */
  resetUses: defineAction('pf1e/resetUses', z.object({ characterId: IdSchema }), {
    authorize(ctx, { characterId }) {
      const c = ctx.state.characters[characterId];
      if (!c) return 'Character not found';
      return canManageCharacter(ctx.user, c) || "You don't control that character";
    },
    audience: (viewer, { characterId }, { state }) => {
      const c = state.characters[characterId];
      return !!c && (isGm(viewer) || c.ownerId === viewer.id || c.shared);
    },
    apply(draft, { characterId }, meta) {
      const c = draft.characters[characterId];
      if (!c) return;
      c.runtime.uses = {};
      c.updatedAt = meta.ts;
    },
  }),
};

/** Hide turn state of hidden combatants from players on snapshot/welcome. */
export const redactPf1eTurns: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  const state = draft as unknown as GameState;
  for (const id of Object.keys(draft.pf1eTurns)) {
    const cb = state.combat.combatants.find((c) => c.id === id);
    if (cb && isCombatantHidden(state, cb)) delete draft.pf1eTurns[id];
  }
};

/** Exported for the UI: current max for every resource a character has. */
export function characterResources(c: Character) {
  const stats = computeCharacterStats(c);
  return classActionSetsFor(c.build.classes).flatMap(({ set, level }) =>
    set.resources.map((def) => {
      const key = resourceKey(set, def.id);
      return { key, set, def, level, used: c.runtime.uses[key] ?? 0, max: resourceMax(c, def, level, stats) };
    }),
  );
}
