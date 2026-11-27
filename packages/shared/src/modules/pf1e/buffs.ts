/**
 * PF1e buffs and conditions in play (Epic 8): add, edit, switch on/off and
 * remove a character's buffs, set the conditions of a character that isn't
 * linked to a token (a linked character follows its token's markers), and
 * count buff durations down as combat turns start.
 *
 * Privacy: buffs live on the character, so these actions only go to people
 * who can see it; expiry notices are whispered to the owner and the GMs.
 */
import { z } from 'zod';
import { defineAction } from '../../actions/define';
import { isGm } from '../../actions/auth';
import { BuffSchema, ConditionNameSchema, IdSchema, MAX_BUFFS, MAX_CONDITIONS, type Character, type GameState, type User } from '../../state';
import { pushMessage } from '../chat';
import { noticeId, noticeRecipients, onTurnStart } from '../combat';
import { canManageCharacter, canSeeCharacter } from './characters';

function manageable(state: GameState, user: User, characterId: string): Character | string {
  const c = state.characters[characterId];
  if (!c) return 'Character not found';
  return canManageCharacter(user, c) ? c : "You don't control that character";
}

const canSeeIt = (viewer: User, characterId: string, state: GameState) => {
  const c = state.characters[characterId];
  return !!c && (isGm(viewer) || canSeeCharacter(viewer, c));
};

const BuffChangesSchema = BuffSchema.pick({ name: true, effects: true, note: true, active: true, roundsLeft: true }).partial();

export const buffActions = {
  add: defineAction('pf1e/addBuff', z.object({ characterId: IdSchema, buff: BuffSchema }), {
    authorize(ctx, { characterId, buff }) {
      const c = manageable(ctx.state, ctx.user, characterId);
      if (typeof c === 'string') return c;
      if (c.runtime.buffs.length >= MAX_BUFFS) return `At most ${MAX_BUFFS} buffs`;
      if (c.runtime.buffs.some((b) => b.id === buff.id)) return 'Buff already exists';
      return true;
    },
    audience: (viewer, { characterId }, { state }) => canSeeIt(viewer, characterId, state),
    apply(draft, { characterId, buff }, meta) {
      const c = draft.characters[characterId];
      if (!c || c.runtime.buffs.length >= MAX_BUFFS || c.runtime.buffs.some((b) => b.id === buff.id)) return;
      c.runtime.buffs.push(buff);
      c.updatedAt = meta.ts;
    },
  }),

  /** Switch on/off, set the rounds left, or edit a buff's name, note and effects. */
  update: defineAction('pf1e/updateBuff', z.object({ characterId: IdSchema, buffId: IdSchema, changes: BuffChangesSchema }), {
    authorize(ctx, { characterId, buffId }) {
      const c = manageable(ctx.state, ctx.user, characterId);
      if (typeof c === 'string') return c;
      return c.runtime.buffs.some((b) => b.id === buffId) || 'Buff not found';
    },
    audience: (viewer, { characterId }, { state }) => canSeeIt(viewer, characterId, state),
    apply(draft, { characterId, buffId, changes }, meta) {
      const b = draft.characters[characterId]?.runtime.buffs.find((x) => x.id === buffId);
      if (!b) return;
      Object.assign(b, changes);
      draft.characters[characterId]!.updatedAt = meta.ts;
    },
  }),

  remove: defineAction('pf1e/removeBuff', z.object({ characterId: IdSchema, buffId: IdSchema }), {
    authorize(ctx, { characterId, buffId }) {
      const c = manageable(ctx.state, ctx.user, characterId);
      if (typeof c === 'string') return c;
      return c.runtime.buffs.some((b) => b.id === buffId) || 'Buff not found';
    },
    audience: (viewer, { characterId }, { state }) => canSeeIt(viewer, characterId, state),
    apply(draft, { characterId, buffId }, meta) {
      const c = draft.characters[characterId];
      if (!c) return;
      c.runtime.buffs = c.runtime.buffs.filter((b) => b.id !== buffId);
      c.updatedAt = meta.ts;
    },
  }),

  /** Conditions of a character without a token. A linked character's conditions are its token's markers (token/update). */
  setConditions: defineAction(
    'pf1e/setConditions',
    z.object({ characterId: IdSchema, conditions: z.array(ConditionNameSchema).max(MAX_CONDITIONS) }),
    {
      authorize(ctx, { characterId }) {
        const c = manageable(ctx.state, ctx.user, characterId);
        if (typeof c === 'string') return c;
        return c.tokenId === null || "This character's conditions are its token's: change them on the token";
      },
      audience: (viewer, { characterId }, { state }) => canSeeIt(viewer, characterId, state),
      apply(draft, { characterId, conditions }, meta) {
        const c = draft.characters[characterId];
        if (!c || c.tokenId !== null) return;
        c.runtime.conditions = [...new Set(conditions)];
        c.updatedAt = meta.ts;
      },
    },
  ),
};

/**
 * Buff timers: a character's buffs count down when its token's turn starts.
 * Characters with timed buffs but no token in the turn order count down once
 * per round instead. At 0 the buff switches off (kept, to switch on again).
 */
onTurnStart((draft, { combatantId, newRound, meta }) => {
  const current = draft.combat.combatants.find((c) => c.id === combatantId);
  const inCombat = new Set(draft.combat.combatants.map((c) => c.tokenId).filter((t): t is string => !!t));
  for (const c of Object.values(draft.characters)) {
    const ticks = c.tokenId && inCombat.has(c.tokenId) ? !!current && current.tokenId === c.tokenId : newRound;
    if (!ticks) continue;
    const ended: string[] = [];
    for (const b of c.runtime.buffs) {
      if (!b.active || b.roundsLeft === null) continue;
      if (b.roundsLeft > 1) b.roundsLeft -= 1;
      else {
        b.active = false;
        b.roundsLeft = null;
        ended.push(b.name);
      }
    }
    if (!ended.length) continue;
    c.updatedAt = meta.ts;
    pushMessage(draft.chat, {
      id: noticeId(meta, `buff|${c.id}|${ended.join('|')}`),
      userId: 'system',
      ts: meta.ts,
      text: `⏱ ${c.name}: ${ended.join(', ')} ended`,
      whisper: { mode: 'whisper', to: noticeRecipients(draft, [c.ownerId]) },
    });
  }
});
