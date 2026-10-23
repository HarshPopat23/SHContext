# Changelog

## Unreleased

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
