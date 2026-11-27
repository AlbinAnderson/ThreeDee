/**
 * PF1e characters: import from PCGen, ownership, token links and re-import.
 *
 * Privacy: a character is visible to its owner, the GM, and (if `shared`)
 * the whole party. Hidden characters are redacted from snapshots, and every
 * action is only delivered to people who could see the character before or
 * after it (with the full character carried to newly-allowed viewers).
 */
import { z } from 'zod';
import type { Draft } from 'immer';
import { defineAction, type AuthContext, type AuthResult, type Redactor } from '../../actions/define';
import { canControlToken, isGm } from '../../actions/auth';
import { PcgenCharacterSchema } from '../../pcgen/schema';
import { mergeReimport } from '../../pf1e/characters';
import { computeCharacterStats } from '../../pf1e/engine';
import { tokenSyncFor } from '../../pf1e/tokenSync';
import {
  CharacterRuntimeSchema,
  CharacterSchema,
  CharacterSheetSchema,
  IdSchema,
  MAX_CHARACTERS_PER_ROOM,
  TokenSchema,
  type Character,
  type GameState,
  type User,
} from '../../state';

const MAX_TOKEN_OWNERS = 50;

export function canSeeCharacter(user: User, c: Character): boolean {
  return isGm(user) || c.ownerId === user.id || c.shared;
}

/** Owner or GM may edit, link, re-import and delete. */
export function canManageCharacter(user: User, c: Character): boolean {
  return isGm(user) || (c.ownerId !== null && c.ownerId === user.id);
}

function requireManage(ctx: AuthContext, id: string): AuthResult {
  const c = ctx.state.characters[id];
  if (!c) return 'Character not found';
  return canManageCharacter(ctx.user, c) || "You don't control that character";
}

/** Deliver to anyone who could see the character before or after the change. */
function beforeOrAfter(viewer: User, id: string, full: Character | undefined, state: GameState) {
  const before = state.characters[id];
  return (!!before && canSeeCharacter(viewer, before)) || (!!full && canSeeCharacter(viewer, full));
}

function putFull(draft: Draft<GameState>, id: string, full: Character | undefined) {
  if (full) draft.characters[id] = full;
}

/** Characters linked to `id` as its master or companions (Epic 9). */
function linkedTo(state: GameState, id: string): Character[] {
  const c = state.characters[id];
  const master = c?.companion ? state.characters[c.companion.masterId] : undefined;
  return [...(master ? [master] : []), ...Object.values(state.characters).filter((o) => o.companion?.masterId === id)];
}

/** Also deliver to anyone who sees a character whose companion link the change may drop. */
function beforeOrAfterOrLinked(viewer: User, id: string, full: Character | undefined, state: GameState) {
  return beforeOrAfter(viewer, id, full, state) || linkedTo(state, id).some((o) => canSeeCharacter(viewer, o));
}

/**
 * A companion belongs to its master's player: drop links between `id` and
 * characters with a different owner (after setOwner), or all its companions'
 * links (when it is deleted).
 */
function dropBrokenLinks(draft: Draft<GameState>, id: string, ts: number, deleted = false) {
  const c = draft.characters[id];
  if (c?.companion) {
    const master = draft.characters[c.companion.masterId];
    if (!master || master.ownerId !== c.ownerId) {
      c.companion = null;
      c.updatedAt = ts;
    }
  }
  for (const o of Object.values(draft.characters)) {
    if (o.companion?.masterId !== id) continue;
    if (deleted || !c || o.ownerId !== c.ownerId) {
      o.companion = null;
      o.updatedAt = ts;
    }
  }
}

const CharacterChangesSchema = CharacterSchema.pick({ name: true, shared: true }).partial();

/** Token fields a character sync may set. */
const TokenSyncSchema = TokenSchema.pick({ name: true, hp: true, darkvision: true, size: true }).extend({ light: TokenSchema.shape.light.optional() });

/** Clamp an initiative modifier to CombatantSchema's valid range. */
const clampInit = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));

/** Apply a sync to the token and to its combatants' initiative modifier and name. */
function applySync(draft: Draft<GameState>, tokenId: string, sync: z.infer<typeof TokenSyncSchema> | undefined, initiative: number | undefined) {
  const token = draft.tokens[tokenId];
  if (token && sync) Object.assign(token, sync);
  const clamped = initiative !== undefined ? clampInit(initiative) : undefined;
  for (const c of draft.combat.combatants) {
    if (c.tokenId !== tokenId) continue;
    if (clamped !== undefined) c.modifier = clamped;
    if (sync?.name !== undefined) c.name = sync.name.trim() || 'Token';
  }
}

/** When a character leaves a token, keep the token's live HP on the character. */
function copyHpBack(draft: Draft<GameState>, c: Draft<Character>) {
  const hp = c.tokenId ? draft.tokens[c.tokenId]?.hp : null;
  if (hp) c.runtime.hp = { current: hp.value, temp: hp.temp, nonlethal: c.runtime.hp?.nonlethal ?? 0 };
}

export const characterActions = {
  /** Save a parsed character into the room. Players import characters for themselves. */
  import: defineAction('character/import', z.object({ character: CharacterSchema }), {
    authorize(ctx, { character: c }) {
      if (ctx.state.characters[c.id]) return 'Character already exists';
      if (Object.keys(ctx.state.characters).length >= MAX_CHARACTERS_PER_ROOM) return 'Too many characters in this room';
      if (c.tokenId !== null) return 'Link a token after importing';
      if (c.ownerId && !ctx.state.users[c.ownerId]) return 'Unknown owner';
      if (!isGm(ctx.user) && c.ownerId !== ctx.user.id) return 'Players can only import their own characters';
      if (c.inventory.items.some((i) => i.lootId !== null)) return 'Imported items cannot reference party loot';
      if (!c.inventory.loadouts.some((l) => l.id === c.inventory.activeLoadoutId)) return 'Invalid active loadout';
      if (Object.keys(c.runtime.prepared).length > 0) return 'Prepare spells after importing';
      if (c.companion !== null) return 'Link companions after importing';
      return true;
    },
    prepare(ctx, { character }) {
      const now = Date.now();
      return {
        character: {
          ...character,
          source: { ...character.source, importedBy: ctx.user.id, importedAt: now },
          createdAt: now,
          updatedAt: now,
        },
      };
    },
    audience: (viewer, { character }) => canSeeCharacter(viewer, character),
    apply(draft, { character }) {
      if (!draft.characters[character.id]) draft.characters[character.id] = character;
    },
  }),

  /** Rename or share/unshare. */
  update: defineAction(
    'character/update',
    z.object({ id: IdSchema, changes: CharacterChangesSchema, full: CharacterSchema.optional() }),
    {
      authorize: (ctx, { id }) => requireManage(ctx, id),
      prepare(ctx, { id, changes }) {
        const before = ctx.state.characters[id]!;
        // Only attach the full character when sharing turns on (so newly-allowed viewers receive it).
        const full = changes.shared === true && !before.shared ? { ...before, ...changes, updatedAt: Date.now() } : undefined;
        return { id, changes, full };
      },
      audience: (viewer, { id, full }, { state }) => beforeOrAfter(viewer, id, full, state),
      apply(draft, { id, changes, full }, meta) {
        if (full) return putFull(draft, id, full);
        const c = draft.characters[id];
        if (c) Object.assign(c, changes, { updatedAt: meta.ts });
      },
    },
  ),

  remove: defineAction('character/delete', z.object({ id: IdSchema }), {
    authorize: (ctx, { id }) => requireManage(ctx, id),
    // Viewers of its companions also need to drop their links.
    audience: (viewer, { id }, { state }) => beforeOrAfterOrLinked(viewer, id, undefined, state),
    apply(draft, { id }, meta) {
      dropBrokenLinks(draft, id, meta.ts, true);
      delete draft.characters[id];
    },
  }),

  /** GM: hand a character to a player (or take it back as an NPC). */
  setOwner: defineAction(
    'character/setOwner',
    z.object({ id: IdSchema, ownerId: IdSchema.nullable(), full: CharacterSchema.optional() }),
    {
      authorize(ctx, { id, ownerId }) {
        if (!isGm(ctx.user)) return 'Only the GM can change who plays a character';
        if (!ctx.state.characters[id]) return 'Character not found';
        if (ownerId && !ctx.state.users[ownerId]) return 'Unknown player';
        return true;
      },
      prepare(ctx, { id, ownerId }) {
        const before = ctx.state.characters[id]!;
        // Only attach the full character when handing to a new player who didn't already see it.
        const full = ownerId !== null && !before.shared && before.ownerId !== ownerId ? { ...before, ownerId, updatedAt: Date.now() } : undefined;
        return { id, ownerId, full };
      },
      // Viewers of linked characters get it too (links to a different owner are dropped), but only allowed viewers get the full character.
      audience: (viewer, { id, full }, { state }) => beforeOrAfterOrLinked(viewer, id, full, state),
      redactPayload: (viewer, p) => (p.full && !canSeeCharacter(viewer, p.full) ? { id: p.id, ownerId: p.ownerId } : p),
      apply(draft, { id, ownerId, full }, meta) {
        if (full) putFull(draft, id, full);
        const c = draft.characters[id];
        if (c) {
          c.ownerId = ownerId;
          c.updatedAt = meta.ts;
        }
        dropBrokenLinks(draft, id, meta.ts);
      },
    },
  ),

  /**
   * Link a character to a board token (or unlink with null). A token has at
   * most one character. When the GM links a player's character, that player
   * also gets control of the token.
   */
  linkToken: defineAction(
    'character/linkToken',
    z.object({
      id: IdSchema,
      tokenId: IdSchema.nullable(),
      /** Filled in by the server: player to add to the token's owners. */
      grantOwnerId: IdSchema.nullable().optional(),
      /** Filled in by the server: the character's stats pushed onto the token. */
      sync: TokenSyncSchema.optional(),
      initiative: z.number().int().optional(),
    }),
    {
      authorize(ctx, { id, tokenId }) {
        const ok = requireManage(ctx, id);
        if (ok !== true || tokenId === null) return ok;
        if (ctx.state.characters[id]!.companion?.harbored) return 'Manifest the companion before linking a token';
        const token = ctx.state.tokens[tokenId];
        if (!token) return 'Token not found';
        if (!canControlToken(ctx.user, token)) return "You don't control that token";
        const occupant = Object.values(ctx.state.characters).find((o) => o.tokenId === tokenId && o.id !== id);
        if (occupant && !canManageCharacter(ctx.user, occupant)) return 'That token is already linked to another character';
        return true;
      },
      prepare(ctx, { id, tokenId }) {
        const c = ctx.state.characters[id]!;
        const token = tokenId ? ctx.state.tokens[tokenId] : undefined;
        const grant =
          token && c.ownerId && isGm(ctx.user) && !token.ownerIds.includes(c.ownerId) && token.ownerIds.length < MAX_TOKEN_OWNERS
            ? c.ownerId
            : null;
        if (!token) return { id, tokenId, grantOwnerId: grant };
        return {
          id,
          tokenId,
          grantOwnerId: grant,
          sync: tokenSyncFor(ctx.state, c, token),
          initiative: clampInit(computeCharacterStats(c).initiative.total),
        };
      },
      // Everyone gets it: the token (public) may change. The payload holds no private data.
      apply(draft, { id, tokenId, grantOwnerId, sync, initiative }, meta) {
        const c = draft.characters[id];
        if (c && c.tokenId && c.tokenId !== tokenId) copyHpBack(draft, c);
        if (tokenId) {
          for (const other of Object.values(draft.characters)) {
            if (other.tokenId === tokenId && other.id !== id) {
              copyHpBack(draft, other);
              other.tokenId = null;
            }
          }
          const token = draft.tokens[tokenId];
          if (token && grantOwnerId && !token.ownerIds.includes(grantOwnerId) && token.ownerIds.length < MAX_TOKEN_OWNERS) {
            token.ownerIds.push(grantOwnerId);
          }
          applySync(draft, tokenId, sync, initiative);
        }
        if (c) {
          c.tokenId = tokenId;
          // The token's condition markers drive the character's condition effects while linked.
          const token = tokenId ? draft.tokens[tokenId] : undefined;
          if (token) c.runtime.conditions = [...token.conditions];
          c.updatedAt = meta.ts;
        }
      },
    },
  ),

  /** Replace the build with a newer .pcg export, keeping owner, token link, sharing and runtime state. */
  reimport: defineAction(
    'character/reimport',
    z.object({ id: IdSchema, build: PcgenCharacterSchema, fileName: z.string().max(255), replaceInventory: z.boolean().optional() }),
    {
      authorize: (ctx, { id }) => requireManage(ctx, id),
      audience: (viewer, { id }, { state }) => beforeOrAfter(viewer, id, undefined, state),
      apply(draft, { id, build, fileName, replaceInventory }, meta) {
        const c = draft.characters[id];
        if (c) Object.assign(c, mergeReimport(c as Character, build, { fileName, importedBy: meta.userId, now: meta.ts, replaceInventory }));
      },
    },
  ),
};

export const characterSheetActions = {
  /**
   * Sheet settings and overrides (racial choice, unknown class progressions, armor, misc bonuses...).
   * Like updateRuntime, this can't change who sees the character, so only the changes travel:
   * everyone it's delivered to already has the character.
   */
  updateSheet: defineAction('character/updateSheet', z.object({ id: IdSchema, changes: CharacterSheetSchema.partial() }), {
    authorize: (ctx, { id }) => requireManage(ctx, id),
    audience: (viewer, { id }, { state }) => beforeOrAfter(viewer, id, undefined, state),
    apply(draft, { id, changes }, meta) {
      const c = draft.characters[id];
      if (!c) return;
      Object.assign(c.sheet, changes);
      if (changes.customPools) {
        const byKey = new Map(c.sheet.customPools.map((p) => [`custom.${p.id}`, p.max]));
        for (const k of Object.keys(c.runtime.uses)) {
          if (!k.startsWith('custom.')) continue;
          const max = byKey.get(k);
          if (max === undefined || max <= 0) delete c.runtime.uses[k];
          else if ((c.runtime.uses[k] ?? 0) > max) c.runtime.uses[k] = max;
        }
      }
      c.updatedAt = meta.ts;
    },
  }),

  /** Table state: HP when not linked to a token, ability damage/drain/temp, spent uses. Prepared spells, buffs and conditions have their own actions. */
  updateRuntime: defineAction('character/updateRuntime', z.object({ id: IdSchema, changes: CharacterRuntimeSchema.omit({ prepared: true, buffs: true, conditions: true }).partial() }), {
    authorize: (ctx, { id }) => requireManage(ctx, id),
    audience: (viewer, { id }, { state }) => beforeOrAfter(viewer, id, undefined, state),
    apply(draft, { id, changes }, meta) {
      const c = draft.characters[id];
      if (!c) return;
      Object.assign(c.runtime, changes);
      c.updatedAt = meta.ts;
    },
  }),

  /** Push the character's current numbers onto its linked token (max HP, name, size, darkvision, initiative). */
  syncToken: defineAction(
    'character/syncToken',
    z.object({ id: IdSchema, tokenId: IdSchema.optional(), sync: TokenSyncSchema.optional(), initiative: z.number().int().optional() }),
    {
      authorize(ctx, { id }) {
        const ok = requireManage(ctx, id);
        if (ok !== true) return ok;
        const c = ctx.state.characters[id]!;
        const token = c.tokenId ? ctx.state.tokens[c.tokenId] : undefined;
        if (!token) return 'Link a token first';
        return canControlToken(ctx.user, token) || "You don't control that token";
      },
      prepare(ctx, { id }) {
        const c = ctx.state.characters[id]!;
        const token = ctx.state.tokens[c.tokenId!]!;
        return { id, tokenId: token.id, sync: tokenSyncFor(ctx.state, c, token), initiative: clampInit(computeCharacterStats(c).initiative.total) };
      },
      // The token is public, so everyone applies it; the payload only carries token-visible values.
      apply(draft, { tokenId, sync, initiative }) {
        if (tokenId) applySync(draft, tokenId, sync, initiative);
      },
    },
  ),
};

export const redactCharacters: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const c of Object.values(draft.characters)) if (!canSeeCharacter(viewer, c as Character)) delete draft.characters[c.id];
};

/** Copy a token's conditions onto the characters linked to it (their condition effects follow the map markers). */
export function mirrorTokenConditions(draft: Draft<GameState>, tokenId: string) {
  const token = draft.tokens[tokenId];
  if (!token) return;
  for (const c of Object.values(draft.characters)) if (c.tokenId === tokenId) c.runtime.conditions = [...token.conditions];
}

/** Called when a token is deleted: keep its HP on the character and drop the link. */
export function unlinkToken(draft: Draft<GameState>, tokenId: string) {
  for (const c of Object.values(draft.characters)) {
    if (c.tokenId !== tokenId) continue;
    copyHpBack(draft, c);
    c.tokenId = null;
  }
}
