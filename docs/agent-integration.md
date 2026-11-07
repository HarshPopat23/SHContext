# Agent integration: init, status and MCP

These commands make the generated `context/` tree usable by any coding agent
without extra setup. All three are offline, need no API key, and never write to
`context/` or to source (`init` writes only the files listed below).

## `shcontext init [directory] [--claude] [--mcp] [--no-ignore]`

Run once, **before the first build**.

| File               | What init does                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `AGENTS.md`        | Adds one block between `<!-- shcontext:start -->` / `<!-- shcontext:end -->`. Text outside is kept. |
| `CLAUDE.md`        | Same block, only with `--claude`.                                                                   |
| `.mcp.json`        | With `--mcp`, adds a `shcontext` server entry. An existing different entry is left unchanged.       |
| `.shcontextignore` | Adds the files above so editing them never makes context stale. Skip with `--no-ignore`.            |

Re-running is a no-op. A half-present marker, a symlinked or hard-linked target,
or an invalid `.mcp.json` aborts without changing that file. The block tells an
agent to check freshness first, read `context/<folder>/CONTEXT.md` only for fresh
folders, confirm important claims against the cited lines, and never hand-edit
`context/`.

## `shcontext status [directory]`

Per-folder freshness. `verify` answers "is the whole tree fresh?"; `status`
answers "which folder summaries can I still trust?". A folder is stale when any
file in its subtree was added, modified or deleted, or when selection or
generation components changed (then every folder is stale). Folders with new
source but no summary are listed in `new_folders`.

Exit status: `0` current, `2` current with partial coverage, `1` stale, missing,
invalid or unknown. `current` is a mechanical statement about source identity; it
does not certify that the prose is accurate.

## `shcontext mcp [--root directory]`

A stdio MCP server (newline-delimited JSON-RPC, no extra dependencies). Register
it with `shcontext init --mcp` or manually (`command: shcontext`, `args: [mcp]`).
Claude Code starts MCP servers in the project directory, so `--root` is usually
unnecessary.

| Tool         | Purpose                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `ctx_status` | Per-folder freshness. Call first.                                                                  |
| `ctx_query`  | Path/symbol/text/summary search with hash-checked source references (same engine as `query`).      |
| `ctx_folder` | One folder's context document plus whether that folder is fresh and which files changed.           |
| `ctx_cite`   | Current lines behind a citation; with the citation's `sha256` it reports whether the file drifted. |
| `ctx_verify` | Repository-wide verification findings.                                                             |

Safety: tools are read-only. `ctx_cite` can only read files the scanner analyzed
under the normal ignore and credential policy; absolute paths, `..`, ignored,
unsupported or secret-bearing files are refused. Tool failures return MCP tool
errors with no repository content. Generated prose remains a navigation aid.

## Keeping context current

- **Session hook** ([hooks/session-status.mjs](examples/hooks/session-status.mjs),
  [claude-settings.json](examples/hooks/claude-settings.json)): a Claude Code
  `SessionStart` hook that tells the agent which folders are fresh or stale. It is
  silent when `shcontext` is absent and never fails a session.
- **Update PR workflow** ([context-update-pr.yml](examples/context-update-pr.yml)):
  opt-in GitHub Action that runs `shcontext update` with a spending cap after a
  merge to `main` and opens a PR for human review. It uses only the built-in
  `GITHUB_TOKEN` and `gh`, no third-party actions, and never runs on
  `pull_request_target`. It sends source to the model provider; read
  [ci.md](ci.md) before enabling it.

Not yet implemented: a model-free refresh of the deterministic layer (inventory,
symbols, dependency edges) and a file watcher. Until then `update` is the refresh
path, and `status` tells you what it would touch.
