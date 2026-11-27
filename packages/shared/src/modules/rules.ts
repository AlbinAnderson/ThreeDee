/**
 * Room-level rules settings, GM custom rules catalog (AoN imports / homebrew),
 * and GM-only NPC monster spawning (Epic 11).
 *
 * Wire privacy:
 *  - `customRules` with `gmOnly: true` never leave the GM view (neither in
 *    action payloads nor in snapshots). Turning a public rule `gmOnly: true`
 *    sends a stripped removal marker to players so they drop their copy.
 *  - `rules/spawnMonster` is strictly GM-only (audience = GM), so neither the
 *    NPC character nor its hidden token leaks to non-GM players.
 */
import { z } from 'zod';
import { defineAction, type Redactor } from '../actions/define';
import { isGm, requireGm } from '../actions/auth';
import {
  CharacterSchema,
  CustomRuleSchema,
  IdSchema,
  MAX_CHARACTERS_PER_ROOM,
  MAX_CUSTOM_RULES,
  RulesSettingsSchema,
  TokenSchema,
} from '../state';
import { buildHasDmNotes } from '../pf1e/bio';
import { normalizeAonUrl } from '../rules/aonUrl';

export const rulesActions = {
  /** GM: set which rules-pack books are allowed in this campaign (null = all books). */
  setAllowedSources: defineAction('rules/setAllowedSources', z.object({ allowedSources: RulesSettingsSchema.shape.allowedSources }), {
    authorize: (ctx) => requireGm(ctx),
    apply(draft, { allowedSources }) {
      draft.rules.allowedSources = allowedSources ? [...allowedSources] : null;
    },
  }),

  /** GM: save a reviewed AoN draft or homebrew record into the room's custom rules catalog. */
  saveCustom: defineAction(
    'rules/saveCustom',
    z.object({
      rule: CustomRuleSchema.nullable(),
      /** Internal removal id used when a previously public rule becomes gmOnly. */
      removeId: IdSchema.optional(),
    }),
    {
      authorize(ctx, { rule }) {
        const gm = requireGm(ctx);
        if (gm !== true) return gm;
        if (!rule) return 'Missing rule record';
        if (rule.aonUrl !== null && !normalizeAonUrl(rule.aonUrl)) return 'AoN link must be an allowlisted https://www.aonprd.com/*Display.aspx URL';
        if (!ctx.state.customRules[rule.id] && Object.keys(ctx.state.customRules).length >= MAX_CUSTOM_RULES) {
          return `At most ${MAX_CUSTOM_RULES} custom rules`;
        }
        return true;
      },
      prepare(_ctx, { rule }) {
        const r = rule!;
        return {
          rule: {
            ...r,
            aonUrl: r.aonUrl ? normalizeAonUrl(r.aonUrl) : null,
            createdAt: r.createdAt || Date.now(),
          },
        };
      },
      audience(viewer, { rule }, { state }) {
        if (isGm(viewer)) return true;
        if (!rule) return false;
        if (!rule.gmOnly) return true;
        const prev = state.customRules[rule.id];
        return !!prev && !prev.gmOnly;
      },
      redactPayload(viewer, p) {
        if (isGm(viewer) || !p.rule?.gmOnly) return p;
        return { rule: null, removeId: p.rule.id };
      },
      apply(draft, { rule, removeId }) {
        if (removeId) {
          delete draft.customRules[removeId];
          return;
        }
        if (rule) draft.customRules[rule.id] = rule;
      },
    },
  ),

  /** GM: remove a custom rule from the room. */
  deleteCustom: defineAction('rules/deleteCustom', z.object({ id: IdSchema }), {
    authorize(ctx, { id }) {
      const gm = requireGm(ctx);
      if (gm !== true) return gm;
      return !!ctx.state.customRules[id] || 'Custom rule not found';
    },
    audience(viewer, { id }, { state }) {
      if (isGm(viewer)) return true;
      const prev = state.customRules[id];
      return !!prev && !prev.gmOnly;
    },
    apply(draft, { id }) {
      delete draft.customRules[id];
    },
  }),

  /**
   * GM: import a monster stat block as a GM-only NPC character (unshared, no
   * owner) and optionally spawn its hidden map token in one atomic action.
   */
  spawnMonster: defineAction(
    'rules/spawnMonster',
    z.object({
      character: CharacterSchema,
      token: TokenSchema.nullable(),
    }),
    {
      optimistic: false,
      authorize(ctx, { character: c, token }) {
        const gm = requireGm(ctx);
        if (gm !== true) return gm;
        if (ctx.state.characters[c.id]) return 'Character already exists';
        if (Object.keys(ctx.state.characters).length >= MAX_CHARACTERS_PER_ROOM) return 'Too many characters in this room';
        if (c.ownerId !== null || c.shared) return 'Imported monsters must be GM-only (unshared, no player owner)';
        if (c.companion !== null) return 'Link companions after importing';
        if (buildHasDmNotes(c.build)) return 'GM notes must be moved out of the imported build';
        if (token) {
          if (!ctx.state.scenes[token.sceneId]) return 'Scene not found';
          if (ctx.state.tokens[token.id]) return 'Token already exists';
          if (!token.hidden) return 'Monster tokens start hidden from players';
          if (c.tokenId !== token.id) return 'Monster character must reference its spawned token';
        } else if (c.tokenId !== null) {
          return 'Link a token after importing';
        }
        return true;
      },
      prepare(ctx, { character, token }) {
        const now = Date.now();
        return {
          character: {
            ...character,
            ownerId: null,
            shared: false,
            source: { ...character.source, importedBy: ctx.user.id, importedAt: now },
            createdAt: now,
            updatedAt: now,
          },
          token: token ? { ...token, hidden: true, ownerIds: [] } : null,
        };
      },
      audience: (viewer) => isGm(viewer),
      apply(draft, { character, token }) {
        if (draft.characters[character.id]) return;
        if (token && (!draft.scenes[token.sceneId] || draft.tokens[token.id])) return;
        if (token) {
          const cleanRounds = Object.fromEntries(Object.entries(token.conditionRounds).filter(([k]) => token.conditions.includes(k)));
          draft.tokens[token.id] = { ...token, conditionRounds: cleanRounds };
        }
        draft.characters[character.id] = character;
      },
    },
  ),
};

export const redactCustomRules: Redactor = (draft, viewer) => {
  if (isGm(viewer)) return;
  for (const [id, rule] of Object.entries(draft.customRules)) {
    if (rule.gmOnly) delete draft.customRules[id];
  }
};
