#!/usr/bin/env bash
set -euo pipefail

# Repeatable PR & merge automation for pf1eSimplifier.
# Refuses to run on main/master and never stages local-only files (.reviews/, data/, etc.).

FORBIDDEN_REGEX='^(\.reviews/|data/|pcgen_character_management_reference\.md$|\.env(\.|$))'

STAGE_TRACKED=false
ALL_SAFE=false
ADD_PATHS=()
COMMIT_MSG=""
PR_TITLE=""
PR_BODY=""
PR_BODY_FILE=""
DO_MERGE=false
WATCH_DEPLOY=false
SYNC_RULES=false
AUTO_SYNC_RULES=false

usage() {
  cat <<'EOF'
Usage: ship-pr.sh [options] [-- <paths...>]

Options:
  --stage-tracked       Stage tracked modified/deleted/intent-to-add files
  --add <path>          Explicitly stage a file or directory (repeatable)
  --all-safe            Stage all non-ignored changes except forbidden local paths
  --commit <msg>        Commit message (defaults to --title if omitted)
  --title <title>       PR title (defaults to --commit if omitted)
  --body <text>         PR description text
  --body-file <path>    Path to file containing PR description
  --merge               Wait for PR CI checks, squash-merge, delete branch, pull main
  --watch-deploy        After --merge, watch post-merge CI and Deploy workflows
  --sync-rules          After deploy, trigger and watch sync-rules.yml
  --auto-sync-rules     Trigger and watch sync-rules.yml if buildPack.ts changed
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage-tracked) STAGE_TRACKED=true; shift ;;
    --all-safe) ALL_SAFE=true; shift ;;
    --add) ADD_PATHS+=("$2"); shift 2 ;;
    --commit) COMMIT_MSG="$2"; shift 2 ;;
    --title) PR_TITLE="$2"; shift 2 ;;
    --body) PR_BODY="$2"; shift 2 ;;
    --body-file) PR_BODY_FILE="$2"; shift 2 ;;
    --merge) DO_MERGE=true; shift ;;
    --watch-deploy) WATCH_DEPLOY=true; shift ;;
    --sync-rules) SYNC_RULES=true; shift ;;
    --auto-sync-rules) AUTO_SYNC_RULES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; ADD_PATHS+=("$@"); break ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [[ -z "$BRANCH" ]]; then
  echo "ERROR: Detached HEAD. Checkout a feature branch first." >&2
  exit 1
fi
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  echo "ERROR: Refusing to run on '$BRANCH'. Create a feature branch first." >&2
  exit 1
fi

check_no_forbidden_staged() {
  local bad
  bad="$(git diff --cached --name-only | grep -E "$FORBIDDEN_REGEX" || true)"
  if [[ -n "$bad" ]]; then
    echo "ERROR: Forbidden local-only path(s) are staged:" >&2
    echo "$bad" >&2
    exit 1
  fi
}

echo "==> Branch: $BRANCH"

# 1. Stage requested files safely.
if [[ "$ALL_SAFE" == true ]]; then
  while IFS= read -r -d '' entry; do
    status="${entry:0:2}"
    file="${entry:3}"
    if [[ "$status" == R* || "$status" == C* ]]; then
      IFS= read -r -d '' _old_path || true
    fi
    if [[ "$status" != "!!" && ! "$file" =~ $FORBIDDEN_REGEX ]]; then
      git add -- "$file"
    fi
  done < <(git status --porcelain -z --untracked-files=all)
fi

if [[ "$STAGE_TRACKED" == true ]]; then
  # Stage tracked changes (including intent-to-add files) without touching untracked files.
  git add -u
  while IFS= read -r -d '' file; do
    if [[ ! "$file" =~ $FORBIDDEN_REGEX ]]; then
      git add -- "$file"
    fi
  done < <(git diff --name-only --diff-filter=A -z)
fi

if [[ ${#ADD_PATHS[@]} -gt 0 ]]; then
  for p in "${ADD_PATHS[@]}"; do
    if [[ "$p" =~ $FORBIDDEN_REGEX ]]; then
      echo "ERROR: Refusing to stage forbidden path: $p" >&2
      exit 1
    fi
    git add -- "$p"
  done
fi

check_no_forbidden_staged

# 2. Commit staged changes if any exist.
if ! git diff --cached --quiet; then
  COMMIT_MSG="${COMMIT_MSG:-$PR_TITLE}"
  if [[ -z "$COMMIT_MSG" ]]; then
    echo "ERROR: Staged changes exist but neither --commit nor --title was provided." >&2
    exit 1
  fi
  echo "==> Staged files:"
  git diff --cached --stat
  git commit -m "$COMMIT_MSG"
else
  echo "==> No new staged changes to commit."
fi

# Verify branch has at least one commit ahead of origin/main (or local main).
BASE_REF="main"
if git show-ref --verify --quiet refs/remotes/origin/main; then
  BASE_REF="origin/main"
fi
AHEAD_COUNT="$(git rev-list --count "${BASE_REF}..HEAD")"
if [[ "$AHEAD_COUNT" -eq 0 ]]; then
  echo "ERROR: Branch '$BRANCH' has no commits ahead of '$BASE_REF'." >&2
  exit 1
fi

# Detect whether buildPack.ts changed before merging.
BUILDPACK_CHANGED=false
if git diff --name-only "${BASE_REF}...HEAD" | grep -qx 'packages/server/src/rules/buildPack.ts'; then
  BUILDPACK_CHANGED=true
fi

# 3. Push branch.
echo "==> Pushing $BRANCH to origin..."
git push -u origin "$BRANCH"

# 4. Create or reuse PR.
PR_NUM="$(gh pr view "$BRANCH" --json number --jq '.number' 2>/dev/null || true)"
if [[ -n "$PR_NUM" ]]; then
  PR_URL="$(gh pr view "$PR_NUM" --json url --jq '.url')"
  echo "==> Reusing existing PR #$PR_NUM: $PR_URL"
else
  PR_TITLE="${PR_TITLE:-$(git log -1 --pretty=%s)}"
  if [[ -n "$PR_BODY_FILE" ]]; then
    PR_URL="$(gh pr create --base main --head "$BRANCH" --title "$PR_TITLE" --body-file "$PR_BODY_FILE")"
  elif [[ -n "$PR_BODY" ]]; then
    PR_URL="$(gh pr create --base main --head "$BRANCH" --title "$PR_TITLE" --body "$PR_BODY")"
  else
    AUTO_BODY="$(printf "## Summary\n\n%s\n\n## Changed Files\n\n\`\`\`\n%s\n\`\`\`\n" \
      "$(git log --reverse --pretty='- %s' "${BASE_REF}..HEAD")" \
      "$(git diff --stat "${BASE_REF}...HEAD")")"
    PR_URL="$(gh pr create --base main --head "$BRANCH" --title "$PR_TITLE" --body "$AUTO_BODY")"
  fi
  PR_NUM="$(gh pr view "$BRANCH" --json number --jq '.number')"
  echo "==> Opened PR #$PR_NUM: $PR_URL"
fi

if [[ "$DO_MERGE" != true ]]; then
  echo "==> Done (PR opened; pass --merge to wait for CI and squash-merge)."
  exit 0
fi

# 5. Wait for PR check runs to appear, then watch them pass.
echo "==> Waiting for PR #$PR_NUM CI checks..."
CHECKS_FOUND=false
for _ in $(seq 1 15); do
  COUNT="$(gh pr view "$PR_NUM" --json statusCheckRollup --jq '.statusCheckRollup | length' 2>/dev/null || echo 0)"
  if [[ "${COUNT:-0}" -gt 0 ]]; then
    CHECKS_FOUND=true
    break
  fi
  sleep 2
done
if [[ "$CHECKS_FOUND" != true ]]; then
  echo "WARNING: No check runs appeared within 30s; proceeding to gh pr checks --watch anyway." >&2
fi
gh pr checks "$PR_NUM" --watch --interval 5

# 6. Squash-merge, delete branch, and sync local main.
echo "==> Squash-merging PR #$PR_NUM..."
gh pr merge "$PR_NUM" --squash --delete-branch

git checkout main
git pull --ff-only origin main
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git branch -D "$BRANCH" || true
fi

MERGE_SHA="$(git rev-parse HEAD)"
echo "==> Merged into main at $MERGE_SHA"

# 7. Optionally watch post-merge CI -> Deploy.
wait_for_run_id() {
  local workflow="$1"
  local sha="$2"
  local run_id=""
  for _ in $(seq 1 20); do
    run_id="$(gh run list --workflow "$workflow" --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
    if [[ -n "$run_id" ]]; then
      echo "$run_id"
      return 0
    fi
    sleep 3
  done
  return 1
}

if [[ "$WATCH_DEPLOY" == true ]]; then
  echo "==> Watching post-merge CI for $MERGE_SHA..."
  CI_RUN_ID="$(wait_for_run_id "ci.yml" "$MERGE_SHA" || true)"
  if [[ -n "$CI_RUN_ID" ]]; then
    echo "==> Watching CI run $CI_RUN_ID..."
    gh run watch "$CI_RUN_ID" --exit-status --interval 5
  else
    echo "WARNING: Timed out waiting for post-merge ci.yml run for $MERGE_SHA" >&2
  fi

  echo "==> Watching Deploy workflow for $MERGE_SHA..."
  DEPLOY_RUN_ID="$(wait_for_run_id "deploy.yml" "$MERGE_SHA" || true)"
  if [[ -n "$DEPLOY_RUN_ID" ]]; then
    echo "==> Watching Deploy run $DEPLOY_RUN_ID..."
    gh run watch "$DEPLOY_RUN_ID" --exit-status --interval 5
  else
    echo "WARNING: Timed out waiting for deploy.yml run for $MERGE_SHA" >&2
  fi
fi

# 8. Optionally trigger & watch sync-rules.yml.
SHOULD_SYNC=false
if [[ "$SYNC_RULES" == true ]]; then
  SHOULD_SYNC=true
elif [[ "$AUTO_SYNC_RULES" == true && "$BUILDPACK_CHANGED" == true ]]; then
  echo "==> Detected packages/server/src/rules/buildPack.ts change; auto-triggering sync-rules.yml."
  SHOULD_SYNC=true
fi

if [[ "$SHOULD_SYNC" == true ]]; then
  PREV_SYNC_ID="$(gh run list --workflow sync-rules.yml --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
  echo "==> Dispatching sync-rules.yml on main..."
  gh workflow run sync-rules.yml --ref main
  SYNC_RUN_ID=""
  for _ in $(seq 1 20); do
    CANDIDATE="$(gh run list --workflow sync-rules.yml --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
    if [[ -n "$CANDIDATE" && "$CANDIDATE" != "$PREV_SYNC_ID" ]]; then
      SYNC_RUN_ID="$CANDIDATE"
      break
    fi
    sleep 3
  done
  if [[ -n "$SYNC_RUN_ID" ]]; then
    echo "==> Watching sync-rules.yml run $SYNC_RUN_ID..."
    gh run watch "$SYNC_RUN_ID" --exit-status --interval 5
  else
    echo "WARNING: Timed out waiting for sync-rules.yml run to appear." >&2
  fi
fi

echo "==> All done! PR #$PR_NUM ($PR_URL) merged to main ($MERGE_SHA)."
