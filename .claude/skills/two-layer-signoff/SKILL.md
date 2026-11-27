---
name: two-layer-signoff
description: Independent two-layer code review sign-off workflow for evaluating .reviews/*.md audit reports and .reviews/*.patch files before merging into an integration branch. Use when reviewing an audit report or applying review fixes.
---

# Two-Layer Review Sign-Off Playbook

Use this workflow when asked to sign off on an audit report in `.reviews/`:

## 1. Read Both Files Completely
- Read `.reviews/<branch>-review.md` and `.reviews/<branch>-fixes.patch` in full before making changes.
- Verify you are on the target epic branch (`git checkout <branch>`). Never modify, stage, or commit `.reviews/` or unrelated untracked files.

## 2. Independently Evaluate Every Finding & Fix
This is a genuine **two-layer sign-off**, not rubber-stamping:
- Check every finding against the actual source code and PF1e rules (AoN/CRB) independently.
- For each finding, decide:
  1. **Agree with finding & patch** — apply as written.
  2. **Agree with finding, refine implementation** — apply the patch as a base (or write your own fix) and fix any edge cases in the patch itself, adding regression tests.
  3. **Disagree with finding** — explain why clearly and omit it.
- For high-severity security or wire-privacy fixes, verify the regression test actually fails if the guard is temporarily disabled, then re-enable it.

## 3. Test, Commit & Integrate
1. Run `npm run ci` and confirm typecheck, all test tiers, and Vite build pass with zero errors.
2. Stage ONLY the modified epic files explicitly (never `git add -A`), commit to `<branch>`, and push `<branch>` to `origin`.
3. If integrating into `overnight-main`, switch to `overnight-main`, merge `<branch>`, and push `overnight-main` to `origin`. **Never** merge into or push `main` unless explicitly requested.

## 4. Sign-Off Report
Summarize clearly:
- A table of verdicts for every finding (#1..N), noting any patch refinements or disagreements.
- `npm run ci` test count and result.
- Exact commit SHAs pushed for `<branch>` and the integration branch.
