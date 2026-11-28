---
name: ship-pr
description: Commits a feature branch safely, opens a GitHub PR, waits for CI checks, squash-merges into main, updates local main, and optionally watches the production Deploy and Sync Rules Pack workflows. Use whenever shipping, opening a PR, or merging a branch to main in this repository.
---

# Ship PR to Main

Automates the repeatable commit -> push -> PR -> CI -> squash-merge -> main sync -> prod deploy verification flow in a single script call.

## Workflow

1. **Run local validation first (sandboxed):**
   ```bash
   npm run ci
   ```
   Do not run `npm run ci` inside the unsandboxed ship script; keep local verification sandboxed so only git/GitHub network operations run unsandboxed.

2. **Ship the branch in one command (unsandboxed):**
   Use a clean, prefix-matchable command shape (literal arguments, no `$(...)` or `$VAR` in the shell line) so the user can approve `bash .agents/skills/ship-pr/scripts/ship-pr.sh` once:

   ```bash
   bash .agents/skills/ship-pr/scripts/ship-pr.sh \
     --stage-tracked \
     --add path/to/new-file.ts \
     --commit "Short imperative commit message" \
     --title "PR title" \
     --body-file /tmp/pr-body.md \
     --merge \
     --watch-deploy \
     --auto-sync-rules
   ```

## Script Options

- `--stage-tracked` — stages tracked modified/deleted files (including `git add -N` files).
- `--add <path>` — explicitly stages a file or directory (repeatable).
- `--all-safe` — stages all non-ignored changes except forbidden local files.
- `--commit <msg>` — commit subject (required if there are staged changes).
- `--title <title>` — PR title (defaults to `--commit`).
- `--body <text>` / `--body-file <path>` — PR description (optional; defaults to a generated commit + diffstat summary).
- `--merge` — waits for PR CI checks to pass, squash-merges and deletes the branch, then switches back to `main` and fast-forwards.
- `--watch-deploy` — after `--merge`, waits for post-merge `CI` and `Deploy` workflows on `main` to succeed.
- `--sync-rules` — after deploy, triggers and watches `.github/workflows/sync-rules.yml`.
- `--auto-sync-rules` — triggers and watches `sync-rules.yml` automatically if `packages/server/src/rules/buildPack.ts` changed in the PR.

## Safety Guards Built Into the Script

- Refuses to run on `main`, `master`, or detached `HEAD`.
- Never stages or commits `.reviews/`, `data/`, `pcgen_character_management_reference.md`, or `.env*` files; aborts if any forbidden path is already staged.
- Reuses an existing open PR for the current branch if one already exists.
- Waits for GitHub check runs to register before invoking `gh pr checks --watch`.
