# Grail fork of pi-subagents

This fork tracks upstream `nicobailon/pi-subagents` and carries Grail-specific orchestration changes.

## Remotes

- `origin`: `https://github.com/neill-k/pi-subagents.git` — our fork
- `upstream`: `https://github.com/nicobailon/pi-subagents.git` — original project

`upstream` has push disabled locally to avoid accidental pushes.

## Branches

- `main`: fork mirror of upstream default branch unless we intentionally change it later.
- `grail-main`: integration branch for Grail changes.

Prefer feature branches from `grail-main`:

```bash
git checkout grail-main
git pull --ff-only origin grail-main
git checkout -b grail/<feature-name>
```

## Sync from upstream

Use the helper script:

```bash
./scripts/sync-upstream.sh
```

Or manually:

```bash
git fetch upstream --tags
git checkout grail-main
git merge --no-ff upstream/main
npm test
```

Resolve conflicts in favor of preserving Grail extension points, then push:

```bash
git push origin grail-main
```

## Local Pi install during development

From this repo:

```bash
pi install -l /home/nkillgore/code/pi-subagents
```

Or temporary run:

```bash
pi -e /home/nkillgore/code/pi-subagents
```

## Grail integration direction

Keep `pi-subagents` focused as the child-agent runtime. Grail should own DAG planning, durable orchestration state, scheduling policy, retries, merge/integration policy, and higher-level UI.
