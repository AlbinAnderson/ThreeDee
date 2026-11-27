/**
 * PF1e companions in play (Epic 9): link a character to a master as its
 * familiar / animal companion / mount / eidolon / phantom / cohort, keep its
 * known tricks, harbor (dismiss, stow) and manifest it, roll Handle Animal,
 * and move hit points with Life Link / Etheric Tether.
 *
 * Invariants (checked in authorize, kept by character/delete and setOwner):
 *  - the link lives on the companion (`character.companion`), one master each;
 *  - no self-links or cycles; at most MAX_COMPANIONS_PER_MASTER per master;
 *  - master and companion have the same owner (both NPCs, or one player's).
 *
 * Privacy: link/trick changes only go to people who can see the companion.
 * Harbor/manifest change a public token, so everyone gets them, but the
 * payload carries only ids and the (public) token. Rolls and HP transfers
 * post chat in the author's chat mode; other viewers get a stripped payload
 * that still applies the public turn/token effects.
 */
import { z } from 'zod';
import type { Draft } from 'immer';
import { defineAction, type AuthContext } from '../../actions/define';
import { canControlToken, isGm } from '../../actions/auth';
import { RollResultSchema, rollDice } from '../../dice';
import {
  adjacentPosition,
  canBeHandled,
  canonicalTrick,
  clampToScene,
  companionLinkProblem,
  companionsOf,
  defaultLink,
  handleAnimalCheck,
  hpLinkName,
  hpView,
  masterOf,
  COMPANION_TYPE_LABEL,
} from '../../pf1e/companions';
import { applySpend, canSpend, effectiveTurn } from '../../pf1e/economy';
import { tokenSyncFor } from '../../pf1e/tokenSync';
import {
  ChatWhisperSchema,
  CompanionTypeSchema,
  createToken,
  IdSchema,
  MAX_COMPANIONS_PER_MASTER,
  MAX_KNOWN_TRICKS,
  TokenSchema,
  TrickNameSchema,
  type Character,
  type CompanionStash,
  type GameState,
  type Token,
  type User,
} from '../../state';
import { canSeeMessage, pushMessage, validateWhisper } from '../chat';
import { isCombatantHidden, removeCombatant } from '../combat';
import { canManageCharacter, canSeeCharacter, unlinkToken } from './characters';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const randomId = (random: (n: number) => number) => Array.from({ length: 16 }, () => ID_ALPHABET[random(ID_ALPHABET.length)]).join('');

const canSeeId = (viewer: User, id: string, state: GameState) => {
  const c = state.characters[id];
  return !!c && canSeeCharacter(viewer, c);
};

function manageable(ctx: AuthContext, id: string, what = 'character'): Character | string {
  const c = ctx.state.characters[id];
  if (!c) return 'Character not found';
  return canManageCharacter(ctx.user, c) ? c : `You don't control that ${what}`;
}

/** The companion and its master, both managed by the user. */
function linkedPair(ctx: AuthContext, companionId: string): { companion: Character; master: Character } | string {
  const companion = manageable(ctx, companionId, 'companion');
  if (typeof companion === 'string') return companion;
  if (!companion.companion) return `${companion.name} isn’t anyone’s companion`;
  const master = masterOf(ctx.state, companion);
  if (!master) return 'Master not found';
  if (!canManageCharacter(ctx.user, master)) return "You don't control that companion's master";
  return { companion, master };
}

/** A unique, cleaned trick list (standard spellings for core tricks). */
function cleanTricks(tricks: string[]): string[] {
  const out: string[] = [];
  for (const raw of tricks) {
    const t = canonicalTrick(raw);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, MAX_KNOWN_TRICKS);
}

/** Remove a token the way token/delete does: live HP back to its character first, then out of the turn order. */
function deleteToken(draft: Draft<GameState>, tokenId: string) {
  unlinkToken(draft, tokenId);
  delete draft.tokens[tokenId];
  for (const cb of [...draft.combat.combatants]) if (cb.tokenId === tokenId) removeCombatant(draft, cb.id);
}

function stashOf(token: Token): CompanionStash {
  return {
    sceneId: token.sceneId,
    x: token.x,
    y: token.y,
    name: token.name,
    imageUrl: token.imageUrl,
    color: token.color,
    size: token.size,
    ownerIds: [...token.ownerIds],
    hidden: token.hidden,
    showName: token.showName,
    hpVisible: token.hpVisible,
    conditionRounds: { ...token.conditionRounds },
  };
}

/**
 * Where a manifesting companion's token goes: next to its master's token,
 * else back where it was harbored, else the middle of the active scene.
 * Players can only place tokens on the active scene. null = no token to place
 * (it had none and its master has none); a string = why it can't be placed.
 */
export function manifestPlacement(state: GameState, user: User, c: Character): { sceneId: string; x: number; y: number } | null | string {
  const stash = c.companion?.stash ?? null;
  const master = masterOf(state, c);
  const masterToken = master?.tokenId ? state.tokens[master.tokenId] : undefined;
  if (!stash && !masterToken) return null;
  const gm = isGm(user);
  const allowed = (sceneId: string) => !!state.scenes[sceneId] && (gm || sceneId === state.activeSceneId);
  const size = tokenSize(state, c);
  if (masterToken && allowed(masterToken.sceneId)) {
    return { sceneId: masterToken.sceneId, ...adjacentPosition(state.scenes[masterToken.sceneId]!, masterToken, size) };
  }
  if (stash && allowed(stash.sceneId)) return { sceneId: stash.sceneId, ...clampToScene(state.scenes[stash.sceneId]!, stash.x, stash.y, size) };
  const active = state.activeSceneId ? state.scenes[state.activeSceneId] : undefined;
  if (!active) return 'No active scene to place the token on';
  const cell = active.grid.size;
  return { sceneId: active.id, ...clampToScene(active, Math.round(active.width / 2 / cell) * cell, Math.round(active.height / 2 / cell) * cell, size) };
}

function tokenSize(state: GameState, c: Character): number {
  return tokenSyncFor(state, c, undefined).size;
}

/** The token a manifesting companion gets back (or a fresh one). */
function manifestToken(state: GameState, c: Character, place: { sceneId: string; x: number; y: number }, id: string): Token {
  const stash = c.companion?.stash ?? null;
  const base = createToken({
    id,
    sceneId: place.sceneId,
    x: place.x,
    y: place.y,
    ownerIds: stash ? stash.ownerIds : c.ownerId ? [c.ownerId] : [],
    ...(stash
      ? { imageUrl: stash.imageUrl, color: stash.color, hidden: stash.hidden, showName: stash.showName, hpVisible: stash.hpVisible }
      : {}),
  });
  const sync = tokenSyncFor(state, c, base);
  const conditions = [...c.runtime.conditions];
  const rounds = stash ? Object.fromEntries(Object.entries(stash.conditionRounds).filter(([k]) => conditions.includes(k))) : {};
  return TokenSchema.parse({ ...base, ...sync, name: sync.name, conditions, conditionRounds: rounds });
}

const HandleModeSchema = z.enum(['handle', 'push']);
type HandleCost = 'free' | 'move' | 'fullRound';
const HANDLE_COST_TEXT: Record<HandleCost, string> = { free: 'free action', move: 'move action', fullRound: 'full-round action' };

/** A side's HP after a Life Link transfer: on the token if linked, else on the character. */
const HpSideSchema = z.object({ id: IdSchema, tokenId: IdSchema.nullable(), current: z.number().int().min(-100000).max(100000).optional() });

function setHp(draft: Draft<GameState>, side: z.infer<typeof HpSideSchema>) {
  if (side.current === undefined) return;
  const token = side.tokenId ? draft.tokens[side.tokenId] : undefined;
  if (token?.hp) {
    token.hp.value = side.current;
    return;
  }
  const c = draft.characters[side.id];
  if (c) c.runtime.hp = { current: side.current, temp: c.runtime.hp?.temp ?? 0, nonlethal: c.runtime.hp?.nonlethal ?? 0 };
}

export const companionActions = {
  /** Make a character the companion of another (or move it to a new master). */
  link: defineAction(
    'companion/link',
    z.object({
      companionId: IdSchema,
      masterId: IdSchema,
      type: CompanionTypeSchema,
      knownTricks: z.array(TrickNameSchema).max(MAX_KNOWN_TRICKS).optional(),
      link: z.boolean().optional(),
    }),
    {
      authorize(ctx, { companionId, masterId }) {
        const companion = manageable(ctx, companionId, 'companion');
        if (typeof companion === 'string') return companion;
        const master = manageable(ctx, masterId, 'master');
        if (typeof master === 'string') return master;
        const problem = companionLinkProblem(ctx.state, companionId, masterId);
        if (problem !== true) return problem;
        if (companion.ownerId !== master.ownerId) return 'A companion must be played by the same player as its master';
        if (companion.companion?.masterId !== masterId && companionsOf(ctx.state, masterId).length >= MAX_COMPANIONS_PER_MASTER)
          return `At most ${MAX_COMPANIONS_PER_MASTER} companions per character`;
        return true;
      },
      audience: (viewer, { companionId }, { state }) => canSeeId(viewer, companionId, state),
      apply(draft, { companionId, masterId, type, knownTricks, link }, meta) {
        const c = draft.characters[companionId];
        if (!c || !draft.characters[masterId] || companionLinkProblem(draft as unknown as GameState, companionId, masterId) !== true) return;
        const prev = c.companion;
        c.companion = {
          masterId,
          type,
          knownTricks: cleanTricks(knownTricks ?? prev?.knownTricks ?? []),
          link: link ?? (prev && prev.type === type ? prev.link : defaultLink(type)),
          harbored: prev?.harbored ?? false,
          stash: prev?.stash ?? null,
        };
        c.updatedAt = meta.ts;
      },
    },
  ),

  /** Stop being a companion. Either side's controller may do it; a harbored companion must be manifested first. */
  unlink: defineAction('companion/unlink', z.object({ companionId: IdSchema }), {
    authorize(ctx, { companionId }) {
      const c = ctx.state.characters[companionId];
      if (!c) return 'Character not found';
      if (!c.companion) return `${c.name} isn’t anyone’s companion`;
      const master = masterOf(ctx.state, c);
      if (!canManageCharacter(ctx.user, c) && !(master && canManageCharacter(ctx.user, master))) return "You don't control that companion";
      if (c.companion.harbored) return 'Manifest it before unlinking';
      return true;
    },
    audience: (viewer, { companionId }, { state }) => canSeeId(viewer, companionId, state),
    apply(draft, { companionId }, meta) {
      const c = draft.characters[companionId];
      if (!c?.companion || c.companion.harbored) return;
      c.companion = null;
      c.updatedAt = meta.ts;
    },
  }),

  /** Change the companion type, Link, or known tricks. */
  update: defineAction(
    'companion/update',
    z.object({
      companionId: IdSchema,
      changes: z.object({ type: CompanionTypeSchema, link: z.boolean(), knownTricks: z.array(TrickNameSchema).max(MAX_KNOWN_TRICKS) }).partial(),
    }),
    {
      authorize(ctx, { companionId }) {
        const pair = linkedPair(ctx, companionId);
        return typeof pair === 'string' ? pair : true;
      },
      audience: (viewer, { companionId }, { state }) => canSeeId(viewer, companionId, state),
      apply(draft, { companionId, changes }, meta) {
        const link = draft.characters[companionId]?.companion;
        if (!link) return;
        // A new type brings its default Link unless Link is set explicitly.
        if (changes.type !== undefined && changes.type !== link.type) {
          link.type = changes.type;
          link.link = defaultLink(changes.type);
        }
        if (changes.link !== undefined) link.link = changes.link;
        if (changes.knownTricks !== undefined) link.knownTricks = cleanTricks(changes.knownTricks);
        draft.characters[companionId]!.updatedAt = meta.ts;
      },
    },
  ),

  /**
   * Harbor / dismiss (true): the companion's token is put away (live HP and
   * conditions stay on the character) and leaves the turn order. Manifest
   * (false): the token comes back next to the master's token, or where it was.
   */
  setHarbored: defineAction(
    'companion/setHarbored',
    z.object({
      companionId: IdSchema,
      harbored: z.boolean(),
      /** Filled in by the server: the token to put away. */
      tokenId: IdSchema.nullable().optional(),
      /** Filled in by the server: the token to place. */
      token: TokenSchema.nullable().optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { companionId, harbored }) {
        const pair = linkedPair(ctx, companionId);
        if (typeof pair === 'string') return pair;
        const { companion: c } = pair;
        const link = c.companion!;
        if (link.harbored === harbored) return harbored ? 'Already harbored' : 'Already manifested';
        if (harbored) {
          const token = c.tokenId ? ctx.state.tokens[c.tokenId] : undefined;
          if (token && !canControlToken(ctx.user, token)) return "You don't control its token";
          return true;
        }
        const place = manifestPlacement(ctx.state, ctx.user, c);
        return typeof place === 'string' ? place : true;
      },
      prepare(ctx, { companionId, harbored }) {
        const c = ctx.state.characters[companionId]!;
        if (harbored) {
          const tokenId = c.tokenId && ctx.state.tokens[c.tokenId] ? c.tokenId : null;
          return { companionId, harbored, tokenId };
        }
        const place = manifestPlacement(ctx.state, ctx.user, c);
        const token = place && typeof place !== 'string' ? manifestToken(ctx.state, c, place, randomId(ctx.random)) : null;
        return { companionId, harbored, token };
      },
      // Everyone gets it: a public token is removed or placed. The payload holds no private data.
      apply(draft, { companionId, harbored, tokenId, token }, meta) {
        const c = draft.characters[companionId];
        if (harbored) {
          const t = tokenId ? draft.tokens[tokenId] : undefined;
          if (c?.companion && !c.companion.harbored) {
            c.companion.harbored = true;
            c.companion.stash = t && c.tokenId === t.id ? stashOf(t as Token) : null;
            c.updatedAt = meta.ts;
          }
          if (t) deleteToken(draft, t.id);
          return;
        }
        if (token && draft.scenes[token.sceneId] && !draft.tokens[token.id]) draft.tokens[token.id] = token;
        if (c?.companion && c.companion.harbored) {
          c.companion.harbored = false;
          c.companion.stash = null;
          if (token && draft.tokens[token.id]) c.tokenId = token.id;
          c.updatedAt = meta.ts;
        }
      },
    },
  ),

  /**
   * Handle Animal: the master has the companion perform a known trick (handle,
   * DC 10) or one it doesn't know (push, DC 25), +2 if it is wounded. Link makes
   * handling a free action and pushing a move action (+4 on the check); in
   * combat the master's turn pays the cost.
   */
  handleAnimal: defineAction(
    'companion/handleAnimal',
    z.object({
      companionId: IdSchema,
      mode: HandleModeSchema,
      trick: TrickNameSchema.optional(),
      chatId: IdSchema,
      whisper: ChatWhisperSchema.optional(),
      // Filled in by the server:
      combatantId: IdSchema.optional(),
      cost: z.enum(['free', 'move', 'fullRound']).optional(),
      dc: z.number().int().min(0).max(100).optional(),
      label: z.string().max(300).optional(),
      result: RollResultSchema.optional(),
      /** Stripped copy for someone who can't read the chat message: only the turn spend applies. */
      silent: z.boolean().optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, p) {
        const pair = linkedPair(ctx, p.companionId);
        if (typeof pair === 'string') return pair;
        const { companion, master } = pair;
        const link = companion.companion!;
        if (!canBeHandled(link.type)) return `Handle Animal is for animals, not a ${COMPANION_TYPE_LABEL[link.type].toLowerCase()}`;
        if (link.harbored) return `${companion.name} isn’t here`;
        if (p.mode === 'handle') {
          if (!p.trick) return 'Choose a trick';
          if (!link.knownTricks.some((t) => t.toLowerCase() === p.trick!.trim().toLowerCase())) return `${companion.name} doesn’t know ${p.trick}: push it instead`;
        }
        const ok = validateWhisper(ctx, p.whisper);
        if (ok !== true) return ok;
        const cb = masterCombatant(ctx.state, master);
        if (cb) {
          const spend = canSpend(effectiveTurn(ctx.state, cb.id), handleAnimalCheck(ctx.state, master, companion, p.mode).cost);
          if (spend !== true) return spend;
        }
        return true;
      },
      prepare(ctx, p) {
        const companion = ctx.state.characters[p.companionId]!;
        const master = masterOf(ctx.state, companion)!;
        const check = handleAnimalCheck(ctx.state, master, companion, p.mode);
        const cb = masterCombatant(ctx.state, master);
        const trick = p.trick ? canonicalTrick(p.trick) : undefined;
        const costText = HANDLE_COST_TEXT[check.cost as HandleCost];
        const label = [
          `${master.name} → ${companion.name}: ${p.mode === 'handle' ? 'Handle' : 'Push'}${trick ? ` (${trick})` : ''}`,
          `Handle Animal vs DC ${check.dc}${check.wounded ? ' (wounded +2)' : ''}`,
          `${costText}${check.linkBonus ? ', Link +4' : ''}${!check.trained && !check.linkBonus ? ', untrained' : ''}`,
        ].join(' · ');
        const hidden = !!cb && isCombatantHidden(ctx.state, cb);
        return {
          companionId: p.companionId,
          mode: p.mode,
          ...(trick ? { trick } : {}),
          chatId: p.chatId,
          ...(hidden ? { whisper: { mode: 'gm' as const, to: [] } } : p.whisper ? { whisper: p.whisper } : {}),
          ...(cb ? { combatantId: cb.id } : {}),
          cost: check.cost as HandleCost,
          dc: check.dc,
          label: label.slice(0, 300),
          result: rollDice(`1d20${check.bonus >= 0 ? '+' : ''}${check.bonus}`, ctx.random),
        };
      },
      // The turn spend is public (like pf1e/act), the roll follows the chat mode; a hidden master's turn stays GM-only.
      audience(viewer, p, { state, meta }) {
        if (!p.combatantId) return canSeeMessage(viewer, meta.userId, p.whisper);
        const cb = state.combat.combatants.find((x) => x.id === p.combatantId);
        return !cb || !isCombatantHidden(state, cb) || isGm(viewer);
      },
      redactPayload(viewer, p, { meta }) {
        if (canSeeMessage(viewer, meta.userId, p.whisper)) return p;
        return { companionId: p.companionId, mode: p.mode, chatId: p.chatId, combatantId: p.combatantId, cost: p.cost, silent: true };
      },
      apply(draft, p, meta) {
        if (p.combatantId && p.cost && draft.combat.active && draft.combat.combatants.some((c) => c.id === p.combatantId)) {
          const e = effectiveTurn(draft as unknown as GameState, p.combatantId);
          const turn = { ...e.turn };
          applySpend(turn, e, p.cost);
          draft.pf1eTurns[p.combatantId] = turn;
        }
        if (p.silent || !p.result || p.dc === undefined) return;
        const success = p.result.total >= p.dc;
        pushMessage(draft.chat, {
          id: p.chatId,
          userId: meta.userId,
          ts: meta.ts,
          text: `${p.label ?? 'Handle Animal'} — ${success ? 'Success' : 'Failure'}`.slice(0, 2000),
          roll: p.result,
          ...(p.whisper ? { whisper: p.whisper } : {}),
        });
      },
    },
  ),

  /**
   * Life Link (eidolon) / Etheric Tether (phantom): the master gives up
   * `amount` hit points to prevent as much damage to the companion. Both sides
   * change in one action, on their tokens when linked.
   */
  hpLink: defineAction(
    'companion/hpLink',
    z.object({
      companionId: IdSchema,
      amount: z.number().int().min(1).max(100000),
      chatId: IdSchema,
      whisper: ChatWhisperSchema.optional(),
      // Filled in by the server: HP after the transfer.
      master: HpSideSchema.optional(),
      companion: HpSideSchema.optional(),
      label: z.string().max(120).optional(),
      subtitle: z.string().max(120).optional(),
      text: z.string().max(400).optional(),
      silent: z.boolean().optional(),
    }),
    {
      optimistic: false,
      authorize(ctx, { companionId, amount, whisper }) {
        const pair = linkedPair(ctx, companionId);
        if (typeof pair === 'string') return pair;
        const { companion, master } = pair;
        const link = companion.companion!;
        const name = hpLinkName(link.type);
        if (!name) return 'Only eidolons (Life Link) and phantoms (Etheric Tether) share hit points';
        if (link.harbored) return `${companion.name} isn’t manifested`;
        for (const c of [master, companion]) {
          const token = c.tokenId ? ctx.state.tokens[c.tokenId] : undefined;
          if (token && !canControlToken(ctx.user, token)) return `You don't control ${c.name}'s token`;
        }
        const m = hpView(ctx.state, master);
        const cp = hpView(ctx.state, companion);
        if (amount > m.current) return `${master.name} has only ${Math.max(0, m.current)} hit points to give`;
        const missing = cp.max - cp.current;
        if (missing <= 0) return `${companion.name} isn’t hurt`;
        if (amount > missing) return `${companion.name} is only missing ${missing} hit points`;
        return validateWhisper(ctx, whisper);
      },
      prepare(ctx, p) {
        const companion = ctx.state.characters[p.companionId]!;
        const master = masterOf(ctx.state, companion)!;
        const m = hpView(ctx.state, master);
        const cp = hpView(ctx.state, companion);
        const name = hpLinkName(companion.companion!.type)!;
        const mNext = m.current - p.amount;
        const cNext = cp.current + p.amount;
        return {
          companionId: p.companionId,
          amount: p.amount,
          chatId: p.chatId,
          ...(p.whisper ? { whisper: p.whisper } : {}),
          master: { id: master.id, tokenId: m.tokenId, current: mNext },
          companion: { id: companion.id, tokenId: cp.tokenId, current: cNext },
          label: `${master.name}: ${name}`.slice(0, 120),
          subtitle: companion.companion!.type === 'phantom' ? 'No action (reaction to damage)' : 'Free action',
          text: `${master.name} sacrifices ${p.amount} HP (now ${mNext}/${m.max}) to keep ${companion.name} going (now ${cNext}/${cp.max}).`.slice(0, 400),
        };
      },
      // Token HP is public, so anyone may need the token side; the chat card and HP of unlinked characters follow visibility.
      audience: (viewer, p, { meta, state }) =>
        canSeeMessage(viewer, meta.userId, p.whisper) ||
        [p.master, p.companion].some((side) => !!side && (!!side.tokenId || canSeeId(viewer, side.id, state))),
      redactPayload(viewer, p, { meta, state }) {
        const keep = (side: z.infer<typeof HpSideSchema> | undefined) =>
          side && (side.tokenId || canSeeId(viewer, side.id, state)) ? side : side ? { id: side.id, tokenId: null } : undefined;
        const chat = canSeeMessage(viewer, meta.userId, p.whisper);
        return {
          companionId: p.companionId,
          amount: p.amount,
          chatId: p.chatId,
          master: keep(p.master),
          companion: keep(p.companion),
          ...(chat ? { whisper: p.whisper, label: p.label, subtitle: p.subtitle, text: p.text } : { silent: true }),
        };
      },
      apply(draft, p, meta) {
        if (p.master) setHp(draft, p.master);
        if (p.companion) setHp(draft, p.companion);
        for (const side of [p.master, p.companion]) {
          const c = side ? draft.characters[side.id] : undefined;
          if (c) c.updatedAt = meta.ts;
        }
        if (p.silent || !p.label) return;
        pushMessage(draft.chat, {
          id: p.chatId,
          userId: meta.userId,
          ts: meta.ts,
          text: '',
          ...(p.whisper ? { whisper: p.whisper } : {}),
          card: { title: p.label, ...(p.subtitle ? { subtitle: p.subtitle } : {}), ...(p.text ? { text: p.text } : {}) },
        });
      },
    },
  ),
};

/** The master's entry in an active turn order, if any. */
function masterCombatant(state: GameState, master: Character) {
  if (!state.combat.active || !master.tokenId) return undefined;
  return state.combat.combatants.find((c) => c.tokenId === master.tokenId);
}
