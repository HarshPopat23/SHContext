# Claude web acceptance evidence

Keep local runtime checks, instruction usability tests and actual account tests
separate. Matching hashes or model review do not prove explanation correctness.

## Current status

- Automated packaging/archive workflow: `tests/web-distribution.test.mjs` and
  `tests/web/test_archives.py` exercise the packaged runtime and hostile inputs.
- Independent model forward test: see `docs/examples/skills/web-forward-results.json`.
  This uses packaged instructions and real Headlamp router source locally in Codex;
  it is not a Claude browser test.
- **Actual Claude web acceptance: BLOCKED, not passed.** On October 23, 2026,
  opening `https://claude.ai/new` in the available browser redirected to Claude's
  sign-in screen. No upload, Claude-authored draft, download or fresh-chat update
  has been observed in an authenticated Claude account. API calls do not substitute
  for this check. No authenticated Claude session is available in this browser.

Do not call the web distribution fully certified until the account test below has
evidence. A successful skill installation alone does not prove runtime execution.

## Actual account test

1. Build from a clean revision using `npm run package:web -- <new-path>
--require-clean`. Record revision, distribution manifest and ZIP SHA-256s.
2. Enable code execution/file creation and install the four individual ZIPs under
   Customize → Skills. Record errors or enabled skill names.
3. Confirm that the account accepts source ZIP attachments into code execution
   (skill ZIP installation alone does not establish this). If rejected, record
   blocked without renaming files or assuming a network download. Attach a source ZIP with two related TS folders and an unrelated folder. Also
   test a source-only archive of Headlamp's `frontend/src/lib/router`. Record input
   hashes/scope and use the build prompt in [the web guide](claude-web.md).
4. Have Claude run preflight and report actual Node/Python versions, using bundled
   modules without npm/network/model keys. If incompatible, record **blocked**
   with the observed version instead of passing the workflow.
5. Inspect the activity: correct skill activation, evidence preparation, each
   Claude-authored structured draft, submit validation, finalize, verify and export.
   Download the ZIP and independently inspect Markdown, manifest/report/cache and
   receipt. Review several claims/citations against source, including unresolved
   or external imports and uncertainty. No source should be executed.
6. Change an implementation file in the source archive. In a **new chat**, attach
   updated source and previous exported context. Ask verify/query first: stale
   freshness must be identified with current-source references and no regeneration.
7. Request update. Check affected folders/parents/dependents regenerate, unrelated
   summaries are reused, then download/inspect the new ZIP. Repeat unchanged:
   there should be zero new drafts and fresh verification.
8. Test an unsafe path/link ZIP and a modified context Markdown with an old
   manifest: both must fail without publishing output. Ask an ordinary coding
   question that should not activate a web context skill.
9. Record date, account tier/policy, visible model label, actual runtimes, prompts,
   skill/input/output hashes, activation, counts, freshness, claim-review notes and
   failures. Omit credentials and private source. Mark every unexecuted stage
   **blocked/not run**.

Acceptance requires unchanged uploaded source, no separate key request, useful
downloadable context with references/coverage, and a fresh-chat update from both
archives. Account limits, missing runtimes, policy or upload rejection are real
blockers, not grounds to simulate successful web acceptance.
