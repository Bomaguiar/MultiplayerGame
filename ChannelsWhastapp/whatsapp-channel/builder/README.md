# Autonomous Build Loop

A plain Python orchestrator that builds software from a backlog — writing code,
running tests, self-correcting on failure, reviewing its own diff, and committing
only green, verified work. It drives short-lived `claude -p` calls; the loop
itself never reasons, so it's deterministic and resumable.

## How it works

For each `pending` task in `backlog.json`:

```
implement (Sonnet) ─▶ npm test ─┬─ FAIL ─▶ feed error back ─▶ retry (≤4×)
                                └─ PASS ─▶ review diff (Haiku) ─┬─ FAIL ─▶ retry
                                                               └─ PASS ─▶ commit
```

- **Scoped:** one task at a time, so diffs stay small and reviewable.
- **Honest:** commits only what passes tests *and* the acceptance review.
- **Resumable:** progress is saved in `backlog.json` (`pending → building → done`/`blocked`). Stop and rerun any time.
- **Safe to stop:** a task that can't go green in 4 rounds is marked `blocked` and the loop halts for a human.

## Run

```bash
cd ChannelsWhastapp/whatsapp-channel/builder

python builder.py --dry-run     # show the plan, change nothing
python builder.py --once        # build exactly one task
python builder.py --task T03    # build a specific task
python builder.py               # build the whole backlog, stop on first block
```

Logs stream to the console and to `logs/builder.log`.

## Tuning

Edit the constants at the top of `builder.py`:

| Constant | Default | Meaning |
|---|---|---|
| `MODEL_BUILD` | `claude-sonnet-4-6` | implementation model |
| `MODEL_REVIEW` | `claude-haiku-4-5-...` | cheap acceptance-review model |
| `MAX_ATTEMPTS` | `4` | implement + correction rounds per task |
| `CLAUDE_TIMEOUT` | `1800` | seconds per claude call |
| `TEST_TIMEOUT` | `900` | seconds per test run |

## The backlog

`backlog.json` defines what gets built. Each task has a `spec`, `acceptance`
criteria (the loop's definition of done), and optional `files_hint`. Add tasks,
reorder them (foundations first), or flip a task's `status` back to `pending` to
rebuild it.

The seed backlog implements the construction platform — see
[`../construction-platform/BLUEPRINT.md`](../construction-platform/BLUEPRINT.md).

## Prerequisites

- `claude` CLI on PATH, authenticated.
- The project's `test_command` (from `backlog.json`) must run from the repo. The
  first task (T01) is responsible for making `npm test` exist and pass.
- Run from inside the git repo — the loop commits with `git`.

## Cost note

Unlike the watcher (which avoids tokens), the build loop *spends* tokens on
purpose — it's writing software. Sonnet does the building, Haiku does the cheap
review. `--once` is the safest way to meter spend while you watch the first task.
