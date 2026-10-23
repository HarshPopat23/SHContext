# Uploaded repository workflow

`WEB` below means the absolute path to this skill's `resources/web.py`, not a
file from the uploaded repository. Run commands in code execution. Python 3.9+
and Node 22.14+ (22.x) or 24.x must already be available. Runtime checks are
authoritative; do not assume a particular Claude sandbox version. The ZIP includes
compiled SHContext and locked production dependencies; no npm install, Git, API
key or network access is required. Do not substitute a Claude Code slash command.

## Choose input and scope

1. Run `python3 "$WEB" preflight`. Stop on an incompatible/missing runtime or
   missing dependency; report its error without attempting a network installation.
2. Locate the attached source ZIP in the execution environment. Use
   `python3 "$WEB" list --source "/path/source.zip"`. Confirm the repository
   wrapper and requested folder from this listing and the attachment. The listing
   shows at most 200 directory names; if truncated, inspect directory names with
   Python's `zipfile` metadata only, without extracting through another tool.
3. A GitHub archive commonly has a wrapper such as `headlamp-main`. Set
   `--repo-prefix headlamp-main` and `--subfolder frontend/src/lib/router` for the
   example request. A ZIP whose files are at its root uses `--repo-prefix .`.
   Do not guess that a named folder exists. Ask for the intended scope if ambiguous.
4. Choose a new writable workspace outside attachments and outside the installed
   skill, for example `/mnt/data/shcontext-work-1`. Its parent must already exist.

```sh
python3 "$WEB" open --source "/path/source.zip" --work "/mnt/data/shcontext-work-1" --repo-prefix "headlamp-main" --subfolder "frontend/src/lib/router"
```

For update, verify or query, add `--previous "/path/previous-context.zip"` to
the same `open` command. These operations require both archives, including in a
new chat. Previous ZIPs are SHContext exports, with `web-context.json` and
`context/.shcontext/{manifest,report,cache}.json`. Use the same **subfolder** as
before; the repository wrapper may change. A different scope requires a new build.
The imported cache is validated before use. It need not be fresh against updated
source. Never delete or repair a rejected cache by inventing hashes.

Only the selected folder is analyzed as a repository root. Its descendants appear
in mirrored context paths. Parent source/configuration/ignore rules and outside
dependencies are not implicitly included: choose a wider root when needed and
report this boundary. The extracted copy gets deterministic configuration with
provider `host` and model label `claude-web-session`. Other configuration fields
are retained and participate in invalidation. This label is host-declared
provenance, not authenticated model identification. The uploaded ZIP is unchanged.

## Build or update, one folder at a time

```sh
python3 "$WEB" prepare --work "/mnt/data/shcontext-work-1"
```

The result is `awaiting_draft`, `ready`, or `published`. Read the returned
`request_file` only when awaiting a draft. The request includes `instructions`,
`input` (bounded source bodies, symbols, evidence, interfaces, dependency edges,
accepted child summaries), and the exact `draft_schema`. Follow that schema and
its instructions. Work from child requests toward parents in the order supplied.
Do not manufacture all summaries with a template or replace analysis with an
automated summarizer. Claude authors every required draft after inspecting evidence.
Read additional source inside the returned root if needed, but claims must cite
supplied evidence IDs; explicitly state uncertainty if that evidence is insufficient.

Write a JSON envelope to an external draft file, e.g. `/mnt/data/folder-draft.json`:

```json
{
  "session_id": "copy from current request",
  "request_id": "copy from current request",
  "draft": {
    "purpose": [],
    "files": [],
    "feature_flows": [],
    "tests": [],
    "uncertainty": []
  }
}
```

This skeleton is **not a valid draft**: populate `purpose` with supported claims
and cover every `input.sources` file exactly once in `files`, with at least one
claim per file. A claim has `kind` (`observed` or `inference`), `text`,
`evidence_ids`, and `rationale` (`null` for observed; explicit reasoning for an
inference). File claims must cite that file's `evidence_id`. Parent purpose/flows
may cite supplied child evidence. A test entry uses `path`, `text`, `evidence_ids`;
list only supplied test evidence and never claim execution. Keep prose within the
request's word limit. Mechanical interfaces/dependencies/references are assembled
by SHContext, not invented in the draft. Explain relationships using confirmed
edges; label unresolved/external/dynamic imports and unsupported behavior.

```sh
python3 "$WEB" submit --work "/mnt/data/shcontext-work-1" --draft "/mnt/data/folder-draft.json"
```

Repeat reading each new request and submitting until `ready`. An unchanged update
may be ready with zero drafts. Invalid submissions do not advance the session:
read the error, correct only the current draft and resubmit. `response.json` is
the only additional filename allowed **inside** the session directory; keep other
scratch files outside it. Never edit session state, request IDs, or source hashes.

```sh
python3 "$WEB" finalize --work "/mnt/data/shcontext-work-1"
python3 "$WEB" verify --work "/mnt/data/shcontext-work-1"
python3 "$WEB" export --work "/mnt/data/shcontext-work-1" --output "/mnt/data/headlamp-context.zip"
```

Return a clickable download of the exported ZIP using Claude's file output. It
contains context, manifest, report, cache and scope receipt; no source, drafts,
session state, keys or model API configuration. It is not a standalone source
backup. Source references resolve against the selected source folder after merging
`context/` beside that source. Report selected scope, coverage, verification state
and uncertainty. Keep the previous ZIP for future updates, including new chats.

## Verify or query only

After opening with source and previous ZIPs:

```sh
python3 "$WEB" verify --work "/mnt/data/shcontext-work-1"
python3 "$WEB" query --work "/mnt/data/shcontext-work-1" --question "Where is authentication handled?"
```

Query returns lexical/symbol/source candidates, dependency traversal and freshness.
Inspect cited current source before explaining behavior; cite source paths and line
ranges and distinguish it from generated prose. Flag stale/missing/partial context;
do not silently update during a read-only question. Mechanical validation establishes
structure and freshness, not that an explanation is correct. Model review is not proof.

## Failures and bounds

- Exit 0: successful operation, fresh complete verification, or a ready/pending
  prepare/submit (pending is not publication). Exit 2: published/fresh **partial**
  coverage, or query with no match/partial coverage; read JSON and disclose it.
  Exit 1: failure, stale/unknown/invalid verification or query context. Do not turn
  this into a success claim.
- Uploads: ZIP only, stored/deflate, no encryption, links/special files, Git
  metadata, unsafe paths or duplicate/case/Unicode collisions. Maximum 64 MiB
  compressed, 128 MiB expanded, 16 MiB/file, 20,000 entries, depth 64, compression
  ratio 200 above a 1 MiB allowance. No automatic stripping, truncation or network
  download. Ask for a smaller source-only archive when limits are exceeded.
- Selected-root `context/` or operational `.shcontext/` in source is rejected;
  provide previous context separately. Malformed previous output fails closed.
- Existing scanner exclusions and source limits still apply. JS/TS have structural
  analysis; unsupported languages are inventory-only. Unsupported behavior is not
  established. Large Headlamp scopes may exceed bounded evidence/session budgets:
  narrow the selection rather than silently omitting folders.
- At most 64 host drafts/session; request 512 KiB, submission 64 KiB, state 8 MiB.
  Source/config/output changes during generation invalidate the session. Preserve
  the interrupted workspace, open a new workspace from stable archives and restart;
  never remove unknown locks or alter source to force a stale session through.
- Finalize uses shared staging, locks, ownership validation and source rechecks.
  Resume it only against the same workspace/session. An execution reset loses
  unpublished drafts; only an exported context ZIP supports cross-chat reuse.
- Runtime and dependencies are bundled as JavaScript, not a Node executable.
  If Node/Python/code execution is unavailable, this workflow is blocked. Claude
  web account limits and installation policies may independently block execution.

The upload contains at most 200 files and no nested archives. Compiled JavaScript
bundles include locked production dependencies; their licenses and version
inventory remain separate resources. No extraction or installation is required.
