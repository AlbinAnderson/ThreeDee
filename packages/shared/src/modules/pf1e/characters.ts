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
import { CharacterSchema, IdSchema, MAX_CHARACTERS_PER_ROOM, type Character, type GameState, type User } from '../../state';

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

const CharacterChangesSchema = CharacterSchema.pick({ name: true, shared: true }).partial();

export const characterActions = {
  /** Save a parsed character into the room. Players import characters for themselves. */
  import: defineAction('character/import', z.object({ character: CharacterSchema }), {
    authorize(ctx, { character: c }) {
      if (ctx.state.characters[c.id]) return 'Character already exists';
      if (Object.keys(ctx.state.characters).length >= MAX_CHARACTERS_PER_ROOM) return 'Too many characters in this room';
      if (c.tokenId !== null) return 'Link a token after importing';
      if (c.ownerId && !ctx.state.users[c.ownerId]) return 'Unknown owner';
      if (!isGm(ctx.user) && c.ownerId !== ctx.user.id) return 'Players can only import their own characters';
      return true;
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
      prepare: (ctx, { id, changes }) => ({ id, changes, full: { ...ctx.state.characters[id]!, ...changes, updatedAt: Date.now() } }),
      audience: (viewer, { id, full }, { state }) => beforeOrAfter(viewer, id, full, state),
      apply(draft, { id, changes, full }) {
        if (full) return putFull(draft, id, full);
        const c = draft.characters[id];
        if (c) Object.assign(c, changes);
      },
    },
  ),

  remove: defineAction('character/delete', z.object({ id: IdSchema }), {
    authorize: (ctx, { id }) => requireManage(ctx, id),
    audience: (viewer, { id }, { state }) => beforeOrAfter(viewer, id, undefined, state),
    apply(draft, { id }) {
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
      prepare: (ctx, { id, ownerId }) => ({ id, ownerId, full: { ...ctx.state.characters[id]!, ownerId } }),
      audience: (viewer, { id, full }, { state }) => beforeOrAfter(viewer, id, full, state),
      apply(draft, { id, ownerId, full }) {
        if (full) return putFull(draft, id, full);
        const c = draft.characters[id];
        if (c) c.ownerId = ownerId;
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
    }),
    {
      authorize(ctx, { id, tokenId }) {
        const ok = requireManage(ctx, id);
        if (ok !== true || tokenId === null) return ok;
        const token = ctx.state.tokens[tokenId];
        if (!token) return 'Token not found';
        return canControlToken(ctx.user, token) || "You don't control that token";
      },
      prepare(ctx, { id, tokenId }) {
        const c = ctx.state.characters[id]!;
        const token = tokenId ? ctx.state.tokens[tokenId] : undefined;
        const grant = token && c.ownerId && isGm(ctx.user) && !token.ownerIds.includes(c.ownerId) ? c.ownerId : null;
        return { id, tokenId, grantOwnerId: grant };
      },
      // Everyone gets it: the token (public) may change. The payload holds no private data.
      apply(draft, { id, tokenId, grantOwnerId }, meta) {
        if (tokenId) {
          for (const other of Object.values(draft.characters)) if (other.tokenId === tokenId && other.id !== id) other.tokenId = null;
          const token = draft.tokens[tokenId];
          if (token && grantOwnerId && !token.ownerIds.includes(grantOwnerId)) token.ownerIds.push(grantOwnerId);
        }
        const c = draft.characters[id];
        if (c) {
          c.tokenId = tokenId;
          c.updatedAt = meta.ts;
        }
      },
    },
  ),

  /** Replace the build with a newer .pcg export, keeping owner, token link, sharing and runtime state. */
  reimport: defineAction(
    'character/reimport',
    z.object({ id: IdSchema, build: PcgenCharacterSchema, fileName: z.string().max(255), full: CharacterSchema.optional() }),
    {
      authorize: (ctx, { id }) => requireManage(ctx, id),
      prepare: (ctx, { id, build, fileName }) => ({
        id,
        build,
        fileName,
        full: mergeReimport(ctx.state.characters[id]!, build, { fileName, importedBy: ctx.user.id, now: Date.now() }),
      }),
      audience: (viewer, { id }, { state }) => beforeOrAfter(viewer, id, undefined, state),
      apply(draft, { id, build, fileName, full }, meta) {
        if (full) return putFull(draft, id, full);
        // Optimistic local apply (the server's `full` replaces it).
        const c = draft.characters[id];
        if (c) Object.assign(c, mergeReimport(c as Character, build, { fileName, importedBy: meta.userId, now: meta.ts }));
      },
    },
  ),
};

export const redactCharacters: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const c of Object.values(draft.characters)) if (!canSeeCharacter(viewer, c as Character)) delete draft.characters[c.id];
};

/** Called when a token is deleted: drop links to it. */
export function unlinkToken(draft: Draft<GameState>, tokenId: string) {
  for (const c of Object.values(draft.characters)) if (c.tokenId === tokenId) c.tokenId = null;
}
