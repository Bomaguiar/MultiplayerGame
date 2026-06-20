#!/usr/bin/env python3
"""
Autonomous build loop — writes software, tests it, self-corrects, commits.

A plain Python orchestrator (no LLM itself) that drives short-lived `claude -p`
calls to implement a backlog of features one at a time. For each task it:

  1. IMPLEMENT   — `claude -p` writes the code for one task only.
  2. TEST        — runs the project's test command.
  3. SELF-CORRECT— on failure, feeds the exact error back to `claude -p` and
                   retries, up to MAX_ATTEMPTS times.
  4. REVIEW      — a second `claude -p` pass audits the diff against the
                   task's acceptance criteria; if it finds a blocker, that
                   becomes another correction round.
  5. COMMIT      — only green, reviewed work is committed. Then on to the next.

State lives in backlog.json so the loop is resumable: stop it any time, run it
again, it picks up the first task that isn't `done`.

Usage:
    python builder.py                 # run until backlog is exhausted
    python builder.py --once          # build exactly one task, then stop
    python builder.py --task T03       # build a specific task id
    python builder.py --dry-run       # print what it would do, change nothing

Backlog format (backlog.json):
    {
      "project": "construction-whatsapp",
      "test_command": "npm test",
      "tasks": [
        {
          "id": "T01",
          "title": "Project model + migrations",
          "spec": "Create the Project entity ...",
          "acceptance": ["projects table exists", "CRUD endpoints return 200"],
          "files_hint": ["api/models/project.*", "api/routes/projects.*"],
          "status": "pending"          // pending | building | done | blocked
        }
      ]
    }
"""

import argparse, json, subprocess, sys, time
from datetime import datetime
from pathlib import Path

# ── Config ───────────────────────────────────────────────────────────────────
ROOT          = Path(__file__).resolve().parent
BACKLOG       = ROOT / "backlog.json"
LOG_DIR       = ROOT / "logs"
MODEL_BUILD   = "claude-sonnet-4-6"   # implementation: capable + cost-sane
MODEL_REVIEW  = "claude-haiku-4-5-20251001"  # review/triage: cheap
CLAUDE_BIN    = "claude"
MAX_ATTEMPTS  = 4                     # implement + correction rounds per task
CLAUDE_TIMEOUT = 1800                 # 30 min per claude call
TEST_TIMEOUT   = 900                  # 15 min per test run

LOG_DIR.mkdir(exist_ok=True)


# ── Backlog state ────────────────────────────────────────────────────────────
def load_backlog():
    if not BACKLOG.exists():
        sys.exit(f"No backlog at {BACKLOG}. Create one (see module docstring).")
    return json.loads(BACKLOG.read_text(encoding="utf-8"))

def save_backlog(b):
    BACKLOG.write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")

def next_task(b, task_id=None):
    for t in b["tasks"]:
        if task_id and t["id"] == task_id:
            return t
        if not task_id and t.get("status", "pending") in ("pending", "building"):
            return t
    return None


# ── Subprocess helpers ───────────────────────────────────────────────────────
def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    (LOG_DIR / "builder.log").open("a", encoding="utf-8").write(line + "\n")

def claude(prompt, model, timeout=CLAUDE_TIMEOUT):
    """One headless Claude call with full tool access in this repo."""
    cmd = [CLAUDE_BIN, "-p", prompt, "--model", model,
           "--permission-mode", "acceptEdits"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return (p.stdout or "") + (("\nSTDERR:\n" + p.stderr) if p.returncode else "")
    except subprocess.TimeoutExpired:
        return "__TIMEOUT__"

def run_tests(test_command):
    """Returns (passed: bool, output: str)."""
    try:
        p = subprocess.run(test_command, shell=True, capture_output=True,
                           text=True, timeout=TEST_TIMEOUT)
        out = (p.stdout or "") + "\n" + (p.stderr or "")
        return p.returncode == 0, out[-6000:]   # keep the tail for the LLM
    except subprocess.TimeoutExpired:
        return False, "__TEST_TIMEOUT__ tests exceeded the time limit."

def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT.parent.parent.parent,
                          capture_output=True, text=True)


# ── Prompts ──────────────────────────────────────────────────────────────────
def build_prompt(task, project):
    return f"""You are implementing ONE task in the {project} codebase. Do only this task.

TASK {task['id']}: {task['title']}

SPEC:
{task['spec']}

ACCEPTANCE CRITERIA (your work must satisfy ALL):
{chr(10).join('- ' + a for a in task['acceptance'])}

LIKELY FILES (hint, not a limit):
{chr(10).join('- ' + f for f in task.get('files_hint', [])) or '- (use your judgment)'}

RULES:
- Implement the task fully, including any tests needed to prove the acceptance criteria.
- Match the existing code style, structure, and conventions of the repo.
- Do NOT implement other backlog items. Keep the change scoped to this task.
- Do NOT commit — the orchestrator handles git.
- If a dependency is missing, add it the way the project already manages deps.
When done, end your reply with one line: DONE: <one-sentence summary>."""

def correct_prompt(task, test_output):
    return f"""The tests are FAILING after your work on task {task['id']}: {task['title']}.

TEST OUTPUT (tail):
{test_output}

Fix the code so the tests pass and all acceptance criteria hold. Do not weaken or
delete tests to make them pass — fix the real cause. Do NOT commit.
End with one line: DONE: <what you fixed>."""

def review_prompt(task, diff):
    return f"""Review this diff for task {task['id']}: {task['title']}.

ACCEPTANCE CRITERIA:
{chr(10).join('- ' + a for a in task['acceptance'])}

DIFF:
{diff[:12000]}

Answer in this exact format:
VERDICT: PASS   (if it fully meets the criteria and has no obvious correctness bug)
or
VERDICT: FAIL
REASON: <one or two sentences on the single most important problem to fix>"""


# ── Core loop ────────────────────────────────────────────────────────────────
def current_diff():
    r = git("diff", "HEAD")
    return r.stdout or ""

def build_one(task, project, test_command, dry_run=False):
    log(f"── Task {task['id']}: {task['title']}")
    if dry_run:
        log("  (dry-run) would implement, test, review, commit.")
        return "dry-run"

    task["status"] = "building"; save_backlog(load_backlog_with(task))

    # Round 1: implement.  Rounds 2..N: correct based on test output.
    for attempt in range(1, MAX_ATTEMPTS + 1):
        prompt = build_prompt(task, project) if attempt == 1 \
                 else correct_prompt(task, last_output)
        log(f"  attempt {attempt}/{MAX_ATTEMPTS}: {'implement' if attempt==1 else 'self-correct'}")
        out = claude(prompt, MODEL_BUILD)
        if out == "__TIMEOUT__":
            log("  !! claude timed out"); last_output = "claude timed out"; continue

        passed, last_output = run_tests(test_command)
        log(f"  tests: {'PASS' if passed else 'FAIL'}")
        if not passed:
            continue

        # Tests green → review pass.
        verdict = claude(review_prompt(task, current_diff()), MODEL_REVIEW,
                         timeout=600)
        if "VERDICT: PASS" in verdict.upper():
            log("  review: PASS")
            return commit_task(task)
        log(f"  review: FAIL → {verdict.strip()[:200]}")
        last_output = "Reviewer rejected the work:\n" + verdict  # feed into next round

    # Exhausted attempts.
    task["status"] = "blocked"
    task["blocked_reason"] = (last_output or "")[:500]
    persist_task(task)
    log(f"  ✗ BLOCKED after {MAX_ATTEMPTS} attempts")
    return "blocked"

def commit_task(task):
    git("add", "-A")
    msg = f"{task['id']}: {task['title']}\n\nAuto-built and verified by the build loop."
    r = git("commit", "-m", msg)
    if r.returncode != 0 and "nothing to commit" not in (r.stdout + r.stderr):
        log(f"  !! commit failed: {r.stderr.strip()[:200]}")
        return "commit-failed"
    task["status"] = "done"
    task["done_at"] = datetime.now().isoformat()
    persist_task(task)
    log(f"  ✓ committed {task['id']}")
    return "done"


# ── backlog persistence keeping a single task in sync ────────────────────────
def load_backlog_with(task):
    b = load_backlog()
    for i, t in enumerate(b["tasks"]):
        if t["id"] == task["id"]:
            b["tasks"][i] = task
    return b

def persist_task(task):
    save_backlog(load_backlog_with(task))


# ── Entry ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="build one task then stop")
    ap.add_argument("--task", help="build a specific task id")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    b = load_backlog()
    project, test_command = b["project"], b["test_command"]
    log(f"Build loop up — project={project}, tests=`{test_command}`")

    built = 0
    while True:
        b = load_backlog()
        t = next_task(b, args.task)
        if not t:
            log("Backlog exhausted (nothing pending). Done.")
            break
        result = build_one(t, project, test_command, dry_run=args.dry_run)
        built += 1
        if args.dry_run or args.once or args.task:
            break
        if result == "blocked":
            log("Stopping: a task is blocked and needs a human. Review logs/backlog.json.")
            break
        time.sleep(1)

    log(f"Build loop finished — {built} task(s) processed.")

if __name__ == "__main__":
    main()
