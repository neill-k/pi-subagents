#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE=${UPSTREAM_REMOTE:-upstream}
UPSTREAM_BRANCH=${UPSTREAM_BRANCH:-main}
INTEGRATION_BRANCH=${INTEGRATION_BRANCH:-grail-main}

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "Missing remote: $UPSTREAM_REMOTE" >&2
  exit 1
fi

git fetch "$UPSTREAM_REMOTE" --tags

git checkout "$INTEGRATION_BRANCH"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit/stash before syncing." >&2
  exit 1
fi

git merge --no-ff "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"

if [ -f package.json ]; then
  npm test
fi

echo "Synced $INTEGRATION_BRANCH with $UPSTREAM_REMOTE/$UPSTREAM_BRANCH."
echo "Push with: git push origin $INTEGRATION_BRANCH"
