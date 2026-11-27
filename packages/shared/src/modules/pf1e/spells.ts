/**
 * PF1e spells in play (Epic 7): cast a spell (spends the prepared spell or
 * slot and posts a spell card), mark a prepared spell cast/uncast, and prepare
 * the day's spells. Slots are restored by pf1e/resetUses (Rest) and adjusted
 * by pf1e/adjustUse, like other resources.
 *
 * Privacy: the cast card follows the chat mode. The action also goes to
 * everyone who can see the character, so their copy of its prepared spells and
 * slots stays in sync; those who may not read the card get the action with
 * `redactPayload` stripping it down to the spend (no card, spell or whisper).
 */
import { z } from 'zod';
import type { Draft } from 'immer';
import { defineAction } from '../../actions/define';
import { isGm } from '../../actions/auth';
import { characterSpellcasting, casterFor, checkPrepared, planCast, spellCard } from '../../pf1e/spells';
import {
  ChatCardSchema,
  ChatWhisperSchema,
  IdSchema,
  MAX_PREPARED_PER_CLASS,
  MetamagicListSchema,
  type Character,
  type GameState,
  type User,
} from '../../state';
import { canSeeMessage, pushMessage, validateWhisper } from '../chat';
import { canManageCharacter, canSeeCharacter } from './characters';

const ClassNameSchema = z.string().trim().min(1).max(80);
const SpellNameSchema = z.string().trim().min(1).max(80);
const LevelSchema = z.number().int().min(0).max(9);

function manageable(state: GameState, user: User, characterId: string): Character | string {
  const c = state.characters[characterId];
  if (!c) return 'Character not found';
  return canManageCharacter(user, c) ? c : "You don't control that character";
}

const canSeeIt = (viewer: User, characterId: string, state: GameState) => {
  const c = state.characters[characterId];
  return !!c && (isGm(viewer) || canSeeCharacter(viewer, c));
};

/** A class still using its .pcg prepared book gets that list copied into runtime before it changes. */
function ownPrepared(c: Draft<Character>, className: string) {
  const info = casterFor(characterSpellcasting(c as Character), className);
  if (!info) return undefined;
  if (!c.runtime.prepared[info.className]) c.runtime.prepared[info.className] = info.prepared.map((p) => ({ ...p, metamagic: [...p.metamagic] }));
  return c.runtime.prepared[info.className];
}

const PrepareEntrySchema = z.object({
  id: IdSchema,
  name: SpellNameSchema,
  level: LevelSchema,
  metamagic: MetamagicListSchema,
  slot: z.enum(['normal', 'bonus']),
});

export const spellActions = {
  /** Cast a spell: spends it (prepared) or a slot (spontaneous/hybrid) and posts a spell card in the current chat mode. */
  cast: defineAction(
    'pf1e/castSpell',
    z.object({
      characterId: IdSchema,
      className: ClassNameSchema,
      preparedId: IdSchema.optional(),
      spellName: SpellNameSchema.optional(),
      level: LevelSchema.optional(),
      metamagic: MetamagicListSchema.optional(),
      convert: z.enum(['cure', 'inflict', 'sna']).optional(),
      chatId: IdSchema,
      whisper: ChatWhisperSchema.optional(),
      /** Filled in by the server: the card, and what the cast spends. */
      card: ChatCardSchema.optional(),
      spend: z
        .object({
          className: ClassNameSchema,
          preparedId: IdSchema.nullable(),
          markCast: z.boolean(),
          slotKey: z.string().max(120).nullable(),
        })
        .optional(),
    }),
    {
      // The card and the spend come from the server's view of the character.
      optimistic: false,
      authorize(ctx, p) {
        const c = manageable(ctx.state, ctx.user, p.characterId);
        if (typeof c === 'string') return c;
        const plan = planCast(c, p);
        if (typeof plan === 'string') return plan;
        return validateWhisper(ctx, p.whisper);
      },
      prepare(ctx, p) {
        const c = ctx.state.characters[p.characterId]!;
        const plan = planCast(c, p);
        if (typeof plan === 'string') return p;
        return {
          ...p,
          card: spellCard(c, plan, c.name, ctx.rules),
          spend: { className: plan.info.className, preparedId: plan.preparedId, markCast: plan.markCast, slotKey: plan.slotKey },
        };
      },
      audience: (viewer, { characterId, whisper }, { state, meta }) => canSeeMessage(viewer, meta.userId, whisper) || canSeeIt(viewer, characterId, state),
      redactPayload: (viewer, payload, { meta }) =>
        canSeeMessage(viewer, meta.userId, payload.whisper)
          ? payload
          : { characterId: payload.characterId, className: payload.className, chatId: payload.chatId, spend: payload.spend },
      apply(draft, { characterId, chatId, whisper, card, spend }, meta) {
        if (!spend) return;
        const c = draft.characters[characterId];
        if (c) {
          if (spend.preparedId && spend.markCast) {
            const p = ownPrepared(c, spend.className)?.find((x) => x.id === spend.preparedId);
            if (p) p.cast = true;
          }
          if (spend.slotKey) c.runtime.uses[spend.slotKey] = (c.runtime.uses[spend.slotKey] ?? 0) + 1;
          c.updatedAt = meta.ts;
        }
        if (card) pushMessage(draft.chat, { id: chatId, userId: meta.userId, ts: meta.ts, text: '', card, ...(whisper ? { whisper } : {}) });
      },
    },
  ),

  /** Check off (or undo) a prepared spell without posting anything. */
  markPrepared: defineAction(
    'pf1e/markPrepared',
    z.object({ characterId: IdSchema, className: ClassNameSchema, preparedId: IdSchema, cast: z.boolean() }),
    {
      authorize(ctx, { characterId, className, preparedId }) {
        const c = manageable(ctx.state, ctx.user, characterId);
        if (typeof c === 'string') return c;
        const info = casterFor(characterSpellcasting(c), className);
        if (!info || info.model !== 'prepared') return `${c.name} doesn't prepare ${className} spells`;
        return info.prepared.some((p) => p.id === preparedId) || "That spell isn't prepared";
      },
      audience: (viewer, { characterId }, { state }) => canSeeIt(viewer, characterId, state),
      apply(draft, { characterId, className, preparedId, cast }, meta) {
        const c = draft.characters[characterId];
        if (!c) return;
        const p = ownPrepared(c, className)?.find((x) => x.id === preparedId);
        if (!p) return;
        p.cast = cast;
        c.updatedAt = meta.ts;
      },
    },
  ),

  /**
   * Prepare the day's spells for one class (prepared and hybrid casters).
   * Replaces that class's list; everything starts uncast. Limited to the
   * class's slots, and for book casters to spells in the book.
   */
  prepare: defineAction(
    'pf1e/prepareSpells',
    z.object({ characterId: IdSchema, className: ClassNameSchema, spells: z.array(PrepareEntrySchema).max(MAX_PREPARED_PER_CLASS) }),
    {
      authorize(ctx, { characterId, className, spells }) {
        const c = manageable(ctx.state, ctx.user, characterId);
        if (typeof c === 'string') return c;
        return checkPrepared(c, className, spells);
      },
      audience: (viewer, { characterId }, { state }) => canSeeIt(viewer, characterId, state),
      apply(draft, { characterId, className, spells }, meta) {
        const c = draft.characters[characterId];
        if (!c) return;
        const info = casterFor(characterSpellcasting(c as Character), className);
        if (!info) return;
        c.runtime.prepared[info.className] = spells.map((s) => ({ ...s, metamagic: [...s.metamagic], cast: false }));
        c.updatedAt = meta.ts;
      },
    },
  ),
};
