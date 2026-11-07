# Agent A/B harness (unvalidated against live agents)

Measures whether an agent finishes real tasks better, cheaper or faster with
SHContext context than without. The repository's earlier benchmarks use scripted
providers and retrieval metrics only; this is the first step toward measuring
what an agent actually does. **It has been tested with a fake agent. It has not
yet been run against Claude Code, Codex or any live model, and no result exists.**

## Arms

| Arm                 | What the agent sees                                      |
| ------------------- | -------------------------------------------------------- |
| `none`              | Checkout only. The baseline.                             |
| `handwritten`       | Checkout plus a human-written `AGENTS.md` you supply.    |
| `shcontext-pointer` | Checkout plus prebuilt `context/` and the pointer block. |
| `shcontext-mcp`     | As above plus `.mcp.json` registering `shcontext mcp`.   |

Add your own arms (for example an LLM-generated `CLAUDE.md` or a Repomix pack) in
`prepareArm`. Strip any `AGENTS.md`/`CLAUDE.md` the repository already ships from
the `none` arm, otherwise the baseline is not a baseline.

## Run

```sh
node benchmarks/agent-ab/run.mjs --tasks my-tasks.json --output results.jsonl --trials 3 --dry-run
node benchmarks/agent-ab/run.mjs --tasks my-tasks.json --output results.jsonl --trials 3
node benchmarks/agent-ab/analyze.mjs --results results.jsonl --baseline none \
  --thresholds thresholds.json --overhead overhead.json
```

See [tasks.example.json](tasks.example.json). The agent command receives the task
prompt as its last argument and is parsed for `result`, `usage`, `total_cost_usd`,
`duration_ms` and `num_turns` (the shape of `claude -p --output-format json`; any
missing field is recorded as null, never invented). Each run gets a fresh copy of
the repository and the copy is deleted afterwards. `command` checks and `setup`
execute repository code: use disposable machines and trusted task files.

## Method rules

- **Pre-register** `thresholds.json` (`min_success_gain`, `max_token_ratio`)
  before the first run. The default verdict passes only if the bootstrap interval
  of the paired success difference excludes zero and the mean gain is at least
  0.10, or success is not meaningfully worse and tokens fall to at most 75%.
- **Charge the build.** Pass `overhead.json` (`{"shcontext-pointer": usd_per_task}`)
  with the context generation cost divided by the number of tasks it serves.
- **Repeat.** At least three trials per task and arm; agent runs are noisy.
  Differences are paired per (task, trial) and reported with a seeded percentile
  bootstrap 95% interval.
- **Measure staleness separately.** Build context at commit N, run tasks at commit
  N+k with and without `shcontext update`; this is the claim that distinguishes
  SHContext from a static `AGENTS.md`.
- Grade without knowing the arm for any subjective rubric. Keep failed and
  timed-out runs in the data.
