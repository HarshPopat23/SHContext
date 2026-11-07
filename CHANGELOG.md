# Changelog

## Unreleased

- Examples: Claude Code `SessionStart` hook for per-folder freshness and an opt-in, spend-capped GitHub Action that opens a context-update PR. `benchmarks/agent-ab/` adds an agent A/B runner and paired-bootstrap analyzer; it is tested with a fake agent only and has produced no results yet.
- **Format change (renderer `markdown-v2`):** summaries no longer embed the repository-wide `input_id`, so an edit rewrites only the edited folder and its ancestors instead of every `CONTEXT.md`. Contexts built with `markdown-v1` must be rebuilt.
- `shcontext init` installs an `AGENTS.md`/`CLAUDE.md` pointer block, `.mcp.json` entry and ignore rules; `shcontext status` reports per-folder freshness; `shcontext mcp` serves five offline read-only tools (`ctx_status`, `ctx_query`, `ctx_folder`, `ctx_cite`, `ctx_verify`) over stdio. See [agent integration](docs/agent-integration.md).
- Claude-native sequential prepare/submit/finalize generation and incremental updates, with no separate model API key. Existing OpenAI generation remains optional.
- Plugin 0.2.0 uses active-host build/update instructions, source-bound structured drafts and shared staged publication. Host model/tokens/cost remain explicitly unverified.

## 0.1.0-alpha.1 — release candidate

- Source-referenced JS/TS context generation, incremental updates, offline
  verification and source/context querying.
- Four roles with sequential defaults, bounded folder concurrency, retries,
  cancellation and caller-priced spending reservations.
- Five skills and a Claude Code workflow plugin.
- Controlled and pinned-repository evaluation with explicit baselines, update
  scenarios, source-reviewed claim controls, runtime and accounting limits.
- Organization freshness CI, install/change/update/verify walkthrough, and
  versioned tarball/checksum/draft-release preparation.
- Provider-reported usage snapshots and a capped opt-in live measurement runner;
  missing usage is explicit and reasoning is not counted twice.

Not yet established: independent live-model explanation quality, actual token
usage/billing results, and authenticated host activation. This candidate has not
been publicly published merely by adding these notes.
