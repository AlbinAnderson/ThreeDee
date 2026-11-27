---
name: implement-epic
description: End-to-end playbook for implementing a PF1e VTT epic branch with 3-tier tests, CI verification, and a two-layer audit handoff summary. Use whenever implementing an epic or multi-issue feature branch.
---

# Implement Epic Playbook

Follow these steps in order when building an epic on `pf1eSimplifier`:

## 1. Confirm Scope & Branch Cleanly
- Check open GitHub issues (`gh issue list` if installed, otherwise GitHub's public issues API for the repo) to confirm all sub-issues and acceptance criteria.
- Branch `epic-<N>-<short-slug>` off the requested integration branch (e.g., `overnight-main`), **never** directly off or into `main`.
- Never modify, stage, commit, or delete untracked local workflow files (`.reviews/`, `pcgen_character_management_reference.md`, `.github/workflows/deploy.yml`, `scripts/`).

## 2. Implement Following `CLAUDE.md`
Before writing code, check all relevant sections of `CLAUDE.md`:
- **Schemas & migrations:** If state shape changes, bump `CURRENT_SCHEMA_VERSION` in `packages/shared/src/state.ts` and add the migration step in `packages/shared/src/migrations.ts`. Cap every `z.record` with `.refine(...)` and enforce unique `id`s on entity arrays.
- **Security & wire privacy:**
  - Guard any new `CharacterRuntimeSchema` field in **both** `character/updateRuntime` and `character/import`.
  - If an action updates shared/public state and also carries private chat/data, implement `redactPayload` on `ActionSpec`.
  - Set `optimistic: false` on any action whose `prepare()` fills required fields for `apply()`.
- **Cross-schema clamping:** Clamp all derived values written into `Token`, `Combatant`, `ChatCard`, or `Template` to the target Zod schema bounds, guarding `grid.unitsPerCell <= 0`.
- **Lifecycle Matrix:** Verify `create` vs `update`, `token/delete`, `scene/delete`, `combat/start`/`end`/`move`/`remove`, `character/reimport`, dependent cleanup on delete/shrink, and `leaveRoom()`.
- **Client UI:** Use string draft state for numeric inputs (never `Number(e.target.value) || 0`), commit on blur/Enter, and use stable unique React keys.

## 3. Write 3-Tier Tests
Reuse `packages/server/test/helpers/harness.ts`:
- `packages/server/test/unit/` — pure `@vtt/shared` logic (no Room/SQLite).
- `packages/server/test/feature/` — multi-user `Room` + SQLite flows.
- `packages/server/test/regression/` — migration test, extreme-value `GameStateSchema.parse` test, authorization checks, and **`assertNoWireLeak(client, sinceIdx, /secret/)`** for every privacy rule.

## 4. Verify & Push
1. Run `npm run ci` (`typecheck` + all test tiers + Vite `build`) until 100% green.
2. If you built UI changes and Playwright MCP is available, smoke-test the live UI for console errors and layout regressions without touching `./data/`.
3. Stage ONLY the epic files explicitly (`git add <file1> <file2> ...`), commit on `epic-<N>-<slug>`, and push to `origin`.

## 5. Audit Handoff Summary
End your reply with:
- Branch name, commit SHA, and `npm run ci` test count.
- Concise summary of what was built.
- **"Verify in audit"**: list any PF1e rules/tables written from memory and any tricky state, privacy, or UI seams worth double-checking.
