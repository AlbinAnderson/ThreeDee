# Project Guardrails (`pf1eSimplifier`)

Read this before implementing or reviewing any epic. Every rule below comes directly from recurring bugs caught in Epics 1–8.

## Commands & Testing
- Fast loop after finishing a feature/epic: `npm run test:fast` (`unit` + `feature`)
- Full PR / merge gate: `npm run ci` (`typecheck` across all 3 workspaces + all 4 test tiers + Vite `build`)
- Put new tests in the 3-tier layout using `packages/server/test/helpers/harness.ts`:
  - `packages/server/test/unit/` — pure `@vtt/shared` logic (no Room/SQLite)
  - `packages/server/test/feature/` — multi-user `Room` + SQLite flows
  - `packages/server/test/regression/` — security, wire-privacy, schema migrations, bug guards
- Never commit untracked local workflow files (`.reviews/`, `pcgen_character_management_reference.md`, `.github/workflows/deploy.yml`, `scripts/`). Stage files explicitly; never `git add -A`.

## 1. Actions, Authorization & Wire Privacy
- **Guard every write entry point:** When a new `CharacterRuntimeSchema` or `CharacterSchema` field has its own validated action (e.g., `prepared`, `buffs`, `conditions`, `inventory`), guard **both** `character/updateRuntime` (omit it) **and** `character/import` (validate or require empty on import).
- **Check cross-entity links:** If an action accepts two IDs (e.g., `combatantId` + `characterId`, or `characterId` + `tokenId`), verify both ownership AND that the two entities are actually linked (and check existing occupants before overwriting a link).
- **Wire privacy, not just UI redaction:** `Room.commit` sends the action payload over WebSocket to every user in `audience`. If an action updates shared/public state AND carries private data (whispers, GM-only cards, secret notes), implement `redactPayload` on `ActionSpec` to strip private fields for non-recipients. Always test wire privacy with `assertNoWireLeak(client, sinceIdx, /secret/)` from `test/helpers/harness.ts` — never rely only on `redactState(room.currentState, user)`.
- **Server-prepared payloads:** Any action whose `prepare()` populates fields required by `apply()` must set `optimistic: false`.
- **Minimal broadcasts:** Never attach a `full` character payload on `update`/`setOwner`/`reimport` unless a viewer is *newly gaining* visibility. Only call `syncLinkedToken` when a token-visible field (`name`, `hp.max`, `darkvision`, `size`, `light`, `initiative`) can actually change.

## 2. Schema Bounds & Clamping
- **Clamp across entity boundaries:** Whenever a field from schema A flows into schema B, clamp to B's exact Zod bounds (e.g., `Character.name` 80 → `Token.name` 60; `darkvision` 600 ft → `Token.darkvision` 200 cells; `initiative` → `Combatant.modifier` `[-100, 100]`; `ChatCard.title` 120; `ChatCardRoll.bonus` `[-100, 200]`; `Template.size` `[0.5, 200]` and `width` `[0.5, 20]`). Guard against `grid.unitsPerCell <= 0`.
- **Bound every map and array:** Every `z.record(...)` needs a max-key `.refine(...)`; every entity array with `id`s needs a unique-ID `.refine(...)`; validate numeric ranges (`min(0)` on damage/drain/counts, dice regex `/^[1-9]\d?d[1-9]\d{0,2}$/`).
- **Schema migrations:** Whenever `state.ts` or `entities/*.ts` changes shape, bump `CURRENT_SCHEMA_VERSION`, add a migration step in `packages/shared/src/migrations.ts`, and add a regression test in `test/regression/`.

## 3. Lifecycle Matrix (Check Every New Piece of State)
Before committing new state, verify all six seams:
1. **`create` vs `update`:** Enforce the same invariants on both (e.g., prune orphaned `conditionRounds` on both `token/create` and `token/update`).
2. **`token/delete` & `scene/delete`:** Clean up linked state *before* deleting the referenced entity (e.g., `unlinkToken` runs before `delete draft.tokens[id]` so live HP is copied back).
3. **Combat lifecycle:** Check `combat/start`, `combat/end`, `combat/next`, `combat/prev`, `combat/move` (delay), and `combat/remove` (removing current combatant). Turn-start hooks must be deterministic across server and client replays and idempotent via `combat.ticks`.
4. **`character/reimport`:** Preserve VTT-owned state (`runtime`, `sheet`, `inventory` unless replaced), sync the linked token if stats changed, and avoid index-based IDs that shift on re-import.
5. **Deletion / shrinking:** Removing or shrinking a parent record (`customPools`, `light: null`, `charges.max`) cleans up or clamps dependent fields (`runtime.uses`, `lit`, `charges.current`).
6. **`leaveRoom()`:** Reset any new client UI zustand stores in `packages/client/src/state/session.ts`.

## 4. PF1e Rules & PCGen Matching
- **No raw substring matching on names:** Never use `.includes()` or unanchored `/word/i` on PCGen/PF1e names (avoid `"Leather Boots"` → armor, `"Acid Arrow"` → Acid flask, `"Class Feature"` → Feat, `"Punching Dagger"` → Dagger, `"Witch Hunter"` → Hunter). Use `normalizeName`, word boundaries (`\b`), and longest-match-first canonical tables.
- **Handle PCGen naming conventions:** Support `"Base (Variant)"` and `"Base, Variant"` (e.g., `Sword (Short)`, `Longbow (Composite)`, `Invisibility (Greater)`, `Cure Light Wounds (Mass)`), comma-separated `legacyFeats`/`virtualFeats`, fractional legacy ranks (floor to int), and case-insensitive skill/ability overrides.
- **Rules belong in the engine, not only the UI:** Enforce mutual exclusions (`activeToggles`), feat deduplication, slot caps, and non-stacking rules (`sizeSteps`, fear/fatigue groups) in `@vtt/shared`, never solely in click handlers.
- **Trace downstream stat flow:** Before adding a modifier, check what already flows downstream so you neither omit nor double-count it (`attack → cmb`, `ac dodge → cmd`, `zero ability → loseDexToAc & abilityDamage`, `Barkskin` enhancement-to-natural-armor stacking with `Mutagen` while staying off touch AC/CMD).

## 5. Client UI Conventions
- **Never use `Number(e.target.value) || 0` on controlled `<input type="number">`:** It traps users at `0` and blocks typing negative numbers (`-2`). Always keep string draft state and parse/clamp on blur, Enter, or submit (or reuse `components/fields.tsx` / `TimerInput`).
- **Commit-on-blur/Enter:** Never dispatch state-mutating actions on every keystroke.
- **React traps:** Never pass `<details open={bool}>` without `onToggle`; always use stable, unique keys (include index if user-editable names can collide); check `manage` / `canControlToken` before showing or enabling action buttons on shared sheets; guard `<select>` initial values against empty/filtered option lists.

## 6. Two-Layer Audit Handoff
When finishing an epic branch for audit, include a short **"Verify in audit"** section listing any PF1e rules/tables written from memory and any tricky state/privacy seams worth double-checking.
