# Claude web acceptance evidence

Keep local runtime checks, instruction usability tests and actual account tests
separate. Matching hashes or model review do not prove explanation correctness.

## Current status

- Automated packaging/archive workflow: `tests/web-distribution.test.mjs` and
  `tests/web/test_archives.py` exercise the packaged runtime and hostile inputs.
- Independent model forward test: see `docs/examples/skills/web-forward-results.json`.
  This uses packaged instructions and real Headlamp router source locally in Codex;
  it is not a Claude browser test.
- **Actual Claude web acceptance: PASSED for the observed account/runtime.** On
  October 23, 2026, the user completed sign-in. The account displayed Free plan
  and Sonnet 5.5 Medium. All four skills installed and were enabled. Node
  v22.22.0 and Python 3.13.17 were observed. No separate model key or dependency
  installation was used. Exact uploaded package/input/output hashes, counts,
  expected failures and limitations are in
  [the account test record](examples/skills/claude-web-results.json).

### Observed execution

- Headlamp router: Claude authored and submitted one draft; finalize, verify and
  export exited 0 with fresh/complete context. The downloaded archive includes
  Markdown, manifest, report, incremental cache and a host-provenance receipt.
- A **new chat** imported changed source plus the downloaded prior context.
  Verify reported stale/source_changed and query reported context_stale (both
  exit 1, as expected). Claude inspected the current auth flag and identified the
  old summary's disagreement while qualifying enforcement outside this scope.
- Update authored one replacement draft and exported fresh/complete context.
  A separate unchanged workspace requested zero drafts, returned changed:false
  and reused the folder. The first export was not overwritten.
- A three-folder fixture built with four drafts, children before root. With a
  confirmed extensionless app→auth import, changing auth regenerated app, auth
  and root (three drafts), reusing util. Independent archive inspection confirmed
  util's prose/evidence unchanged; only the run-wide input_id stamp changed.
- An initial fixture used `.js` for a `.ts` target. Its expected app regeneration
  did **not** occur: that edge is deliberately unresolved by the declared v0.1
  resolver, and the output labeled it missing_target. The confirmed-edge control
  used new fixture copies; the original uploads remained unchanged.
- A traversal ZIP failed list/open (exit 1), and edited previous Markdown with an
  old manifest failed ownership validation (exit 1). Neither published a workspace.
  An ordinary JavaScript question answered directly with an empty activity panel.
- All four downloaded Headlamp/confirmed-fixture outputs passed independent CRC,
  import and fresh/complete verification against their corresponding source.
  Reviewed cited claims about default-route mutation, URL generation, the legacy
  noCluster return value and NotFoundRoute's changed flag against the source.
  This is sample source review, not proof of every explanation.

The uploaded candidate was built while correcting installer defects and honestly
records dirty:true. Its exact hashes are retained. Clean builds update provenance
metadata; they must preserve the tested runtime/instruction bytes. Account limits,
policies and runtime versions still vary. Token usage and cost were not exposed.

### Installer defects found by the real account test

The original dependency-tree packages failed with “Zip contains too many files
(maximum 200)”. A runtime-archive candidate failed with “Zip cannot contain nested
zip files”; it was discarded. Plain JavaScript bundles with scoped license
folder names failed with “Zip file contains path with invalid characters”.
The installed candidate bundles dependencies with pinned esbuild, retains their
licenses under ASCII resource paths and contains 29 files per skill with no
nested archive or consumer node_modules. Producer and distribution tests enforce
these constraints. The nested-archive candidate was never installed or shipped.

The account test below now has observed execution and downloaded-output evidence.
It certifies this bounded flow on the recorded environment, not universal account
compatibility or semantic correctness of every generated claim.

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
