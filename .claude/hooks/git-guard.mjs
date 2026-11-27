#!/usr/bin/env node
/**
 * Claude Code PreToolUse safety hook for Bash commands in pf1eSimplifier.
 * Exits 2 (blocking the tool call and feeding stderr back to Claude) if a
 * command tries to:
 *  1. Run `git add -A`, `git add --all`, or `git add .` (stages untracked files).
 *  2. Stage protected untracked local files (.reviews/, deploy.yml, scripts/, pcgen_character_management_reference.md).
 *  3. Commit, merge, rebase, or push directly to `main` (or force-push any branch).
 *
 * Commands explicitly targeting a temp repo (`git -C /tmp/...`) are ignored.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/git-guard.mjs: ${reason}\n`);
  process.exit(2);
}

function currentBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

try {
  const raw = fs.readFileSync(0, 'utf8');
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const cmd = String(payload?.tool_input?.command ?? '');
  if (!cmd) process.exit(0);

  // Strip quoted strings that are commit messages / prompt bodies? Keep simple: check git invocations directly.
  // Skip commands operating solely on isolated /tmp worktrees.
  if (/\bgit\s+-C\s+\/tmp\//.test(cmd) && !/\bgit\s+(?!-C\s+\/tmp\/)(add|commit|merge|push|rebase)\b/.test(cmd)) {
    process.exit(0);
  }

  // 1. Block blanket git add (-A, --all, or standalone . / ./)
  if (/\bgit\s+add\b[^\n;&|]*(?:(?:^|\s)(?:-A|--all|\.(?:\/)?)(?=\s|$|[;&|]))/.test(cmd)) {
    block('Stage files explicitly (`git add <file1> <file2>`) instead of `git add -A` or `git add .` so untracked local files are never committed.');
  }

  // 2. Block staging local-only untracked paths
  if (/\bgit\s+add\b[^\n;&|]*(?:\.reviews\b|pcgen_character_management_reference\.md|\.github\/workflows\/deploy\.yml|\bscripts\/)/.test(cmd)) {
    block('Do not stage local-only files (.reviews/, pcgen_character_management_reference.md, .github/workflows/deploy.yml, scripts/).');
  }

  // 3. Block force pushes anywhere
  if (/\bgit\s+push\b[^\n;&|]*(?:\s--force(?:-with-lease)?\b|\s-f\b)/.test(cmd)) {
    block('Force-pushing is blocked by repo guardrails.');
  }

  // 4. Block pushing directly to `main` (explicit target or while checked out on `main`)
  if (/\bgit\s+push\b[^\n;&|]*(?:\s|:)main(?:\s|$|[;&|])/.test(cmd)) {
    block('Do not push directly to `main`. Push to your epic branch or `overnight-main` instead.');
  }
  const branch = currentBranch();
  if (branch === 'main') {
    if (/\bgit\s+(?:commit|merge|rebase|cherry-pick|push)\b/.test(cmd)) {
      block('Currently checked out on `main`. Switch to an epic branch or `overnight-main` before committing, merging, or pushing.');
    }
  }

  process.exit(0);
} catch (err) {
  block(`Hook parse error (${err instanceof Error ? err.message : String(err)}); failing closed.`);
}
