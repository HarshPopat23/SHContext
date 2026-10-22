# SHContext specification

Status: v0.1 design contract. The local `scan` operation is implemented; see
[scanner usage and limits](scanner.md). The first generation and offline verification pipelines are implemented; see
[generation](generation.md) and [verification](verification.md). Target release: v0.1. Contract version: 1.

Read this document for product behavior, [context format](context-format.md) for
the output contract, and [architecture](architecture.md) for implementation
boundaries. MUST identifies a release requirement; SHOULD identifies a default
that can change with documented evidence.

## 1. Product promise

Given a local repository or ordinary directory, SHContext MUST generate a
`context/` directory that mirrors the included source directories. Each
`CONTEXT.md` explains the corresponding directory, names its important files,
links to evidence, and makes incomplete analysis visible. The root summary
provides a project overview and links to child summaries.

Context helps a developer or assistant choose which source files to inspect.
Source code remains authoritative. A summary is neither a security audit nor a
proof that the application behaves as described at runtime.

### First-release boundary

| Included in v0.1                                                               | Deferred beyond v0.1                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Local directory input; Git awareness when available                            | Fetching repositories, hosted service, GitHub authentication |
| JavaScript/TypeScript structural analysis and evidence-based summaries         | Full semantic support for other languages                    |
| Markdown/configuration context at the limited levels below                     | Runtime tracing, type checking, complete call graphs         |
| Full builds, incremental updates, scan reports, mechanical verification        | Embedding retrieval, CI automation                           |
| Four sequential roles, opt-in bounded pool and one configured provider adapter | Many provider adapters, autonomous shell agents              |
| Versioned output, source references, content-based freshness                   | Guaranteed factual correctness or identical model prose      |

The build/update/query/verify/benchmark skills remain the longer-term product
plan. In v0.1, build, update, query and verify have underlying operations;
future packaging MUST distinguish available operations from planned ones.

## 2. Inputs and configuration

The caller MUST explicitly select a local root. A selected subdirectory is its
own analysis root; source content outside it MUST NOT be read or referenced as
analyzed evidence. Git metadata may establish tracking status but does not
expand this boundary. Read current working-tree bytes, including modified and
untracked files; do not substitute staged or HEAD contents. A directory need
not be a Git checkout. Never execute its code, package scripts, tests, hooks,
configuration modules, or instructions embedded in files during analysis.

Command surface (`scan`, `build`, `update`, `query` and `verify` implemented):

```sh
shcontext scan .
shcontext build .
shcontext update .
shcontext verify .
shcontext query "Where is authentication handled?"
```

`scan` performs local content gates and syntax validation, then produces a JSON
inventory on stdout and concise diagnostics on stderr, with no model calls or
generated context. `build` creates or replaces
owned generated output. `update` selectively regenerates affected summaries and
publishes through the same owned writer. `verify` reads existing output and current inputs without
model calls or writes. `query` retrieves source-grounded navigation answers and
reports freshness without model calls or writes; see [querying](querying.md).
Build/update support the [four roles](agents.md), bounded concurrency and spending
reservations. These operations MUST NOT commit, push, or modify source.

Configuration is optional root `shcontext.config.json`, parsed as strict JSON
with unknown keys rejected. Duplicate JSON keys MUST be rejected. The v0.1 keys
and defaults are:

| Key               | Default / constraint                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `version`         | Required `1` when the file exists                                                                                                       |
| `maxFileBytes`    | `1048576` (1 MiB); positive integer                                                                                                     |
| `maxInputBytes`   | `20971520` (20 MiB); positive integer, at least `maxFileBytes`                                                                          |
| `maxEntries`      | `10000`; positive integer; includes discovered files and directories                                                                    |
| `folderWordLimit` | `600`; positive integer for generated narrative per non-root folder                                                                     |
| `rootWordLimit`   | `1200`; positive integer for the root narrative                                                                                         |
| `provider`        | `null` when absent; build requires `{ "id": "...", "model": "..." }`; scan/verify preserve this setting without contacting the provider |

Provider IDs are implementation-defined and MUST be listed in the eventual CLI
documentation. Credentials come from explicit process configuration, never
repository content, and MUST NOT appear in output, manifests, or logs. No
provider endpoint may be taken from repository configuration. The selected host
or user configures the endpoint and authorizes the destination before content
is sent; noninteractive builds require this configuration in advance. There is
no discovery or automatic fallback to another provider.

Output is fixed at `<root>/context/` in v0.1. Operational state and staging use
`<root>/.shcontext/`. Reject either path if it is a symlink. User configuration
cannot disable these exclusions or escape the selected root.

## 3. File eligibility and exclusions

Discover regular files and real directories without following symlinks. Include
hidden source/configuration paths under the same rules as other paths. A file
is eligible for content analysis only if it survives selection and is readable,
strict UTF-8 text (an initial UTF-8 BOM is allowed), contains no NUL byte, is
within `maxFileBytes`, and has a supported analysis mode from section 4.

Apply selection in this order; later rules cannot re-include mandatory exclusions:

1. **Mandatory boundaries:** exclude `.git`, `.hg`, `.svn` entries (files or directories), root `context/`,
   root `.shcontext/`, symlinks, special devices/FIFOs/sockets, and nested Git
   repositories/submodules. Report their boundary without traversing them.
2. **Sensitive filenames:** exclude `.env` and `.env.*`, `.npmrc`, `.pypirc`,
   `.netrc`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, and `id_rsa*`/`id_ed25519*`
   basenames at any depth. This deliberately includes `.env.example` in v0.1.
3. **Default noise directories:** exclude `node_modules/`, `vendor/`, `dist/`,
   `build/`, `coverage/`, `.next/`, `.nuxt/`, `.venv/`, `venv/`, `__pycache__/`,
   and `target/` at any depth. No override in v0.1.
4. **Repository `.gitignore` rules:** load rules from the selected root downward,
   using nested patterns and negation semantics
   for untracked paths. Existing tracked files are not excluded by this layer.
   In a non-Git directory, apply these patterns to every discovered path.
5. **Root `.shcontextignore`:** apply Git-style patterns, last match wins, to
   tracked and untracked paths. Negation may undo a rule in this file only; it
   cannot undo an earlier layer. An excluded parent cannot be traversed to
   re-include a child.
6. **Content gates:** classify binary/non-UTF-8, oversized, unsupported, parser
   failures, and unreadable inputs as described below.

The repository-scoped selection deliberately does not load `.git/info/exclude`
or the user's global Git excludes, so those personal settings do not change a
shared build. SHContext is not claiming to duplicate every Git exclusion source.
Git's tracked-file exception and pattern semantics are documented in the
[Git ignore manual](https://git-scm.com/docs/gitignore); tracking/discovery are
separate concerns in [git ls-files](https://git-scm.com/docs/git-ls-files).

A directory matched only by `.gitignore` MUST NOT be pruned when it contains
tracked descendants that survive stronger exclusions. Traverse the necessary
ancestors to retain those files, while still excluding ignored untracked paths.
The `.shcontextignore` and mandatory/noise layers may exclude tracked content.

Ignored directories MUST be pruned and recorded once, with a trailing `/` in
the report. Reserved root `context/` and `.shcontext/` are instead always listed
in `policy_exclusions`, never in observed entries: their creation, removal, or
contents MUST NOT change source identity or entry limits. Do not enumerate
excluded descendants, disclose their contents, or
claim to know their descendant count. Readable selected files MUST undergo a
local credential-pattern check before any provider submission. A finding
excludes the whole file as `sensitive_content`; diagnostics MUST NOT contain
matched values. Detector failure aborts generation. Name rules and detection
cannot guarantee that all secrets are found; generated output requires review
before sharing. This layered approach is informed by
[Repomix's security workflow](https://repomix.com/guide/security).

Fail the run if total readable selected bytes before provider filtering exceed
`maxInputBytes`, discovered entries exceed `maxEntries`, or a selection-control
file cannot be read/parsed. Do not silently process the first N files. Oversized
individual files are instead recorded as skipped and make coverage partial.

## 4. Language and content support

| Input                                                                         | v0.1 mode        | Guaranteed scope / limits                                                                                                                |
| ----------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `.js`, `.jsx`, `.mjs`, `.cjs`                                                 | `structural`     | Syntax declarations, exports, literal imports/re-exports and literal `require()` references; relevant bodies may be read for explanation |
| `.ts`, `.tsx`, `.mts`, `.cts`, including declarations                         | `structural`     | Above plus types/interfaces; declarations describe interfaces, not absent implementation                                                 |
| `.md`, `.mdx`, `.txt`, extensionless `README`/`LICENSE`                       | `text`           | Explain inspected prose and headings; do not execute MDX or treat claims as verified implementation                                      |
| `.json`, `.jsonc`, `.yaml`, `.yml`, `.toml`, `.gitignore`, `.shcontextignore` | `configuration`  | Summarize observed settings/declared scripts or selection rules; no evaluation, schema validation, or dependency installation            |
| Other readable UTF-8 files, such as Python/Rust/Go/HTML/CSS                   | `inventory-only` | Path, size, language hint and hash; no behavioral or dependency claims from their contents                                               |
| Binary/non-UTF-8 files, archives, images and generated source maps (`*.map`)  | `none`           | Path/type/reason only; no decoding, OCR, archive extraction, or semantic summary                                                         |

Configuration mode is a bounded text inspection mode, not a promise to implement
every parser for those formats. Invalid configuration syntax is marked uncertain
when detected; only SHContext's own strict configuration must parse successfully.
Generated code is excluded as `skipped: generated_code` when identified by a
minified filename (`*.min.js`/`*.min.css`) or a recognized generated comment
header in the first 4 KiB; see [detector scope](scanner.md#content-gates-and-limits).
This is a declared policy exclusion and does not alone make coverage partial.

Lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`,
`Cargo.lock`, `poetry.lock`, `uv.lock`) are `skipped: lockfile`, not expanded.

Static relative references may produce dependency edges only when their target
is uniquely resolved within the selected root. Preserve the original specifier
and evidence location. Bare packages are external references; aliases, package
export conditions, computed imports, runtime injection and ambiguous targets
remain explicitly unresolved in v0.1. Do not claim runtime equivalence with Node,
TypeScript, or a bundler. TypeScript documents that
[module resolution depends on the host](https://www.typescriptlang.org/docs/handbook/modules/reference.html).

## 5. Coverage, diagnostics, and folder inclusion

Each discovered entry gets exactly one disposition and a machine-readable
reason, as defined in [the report contract](context-format.md#inventory-and-reports).
Unsupported text is visible, not silently dropped. Parser errors prohibit claims
about the affected file's behavior even if a parser returns a partial tree.
Unreadable entries include sanitized error codes and no guessed content.

Emit a summary for the root and every discovered non-ignored real directory,
including directories with only binary/unsupported files or no files. Excluded
directories receive only a boundary report. An unreadable directory receives a
partial placeholder summary and boundary record; descendants are unknown.
Parent summaries link to child summaries and aggregate their coverage limits.

`complete` means all in-scope text was analyzed at its declared supported level
and traversal was complete. `partial` means at least one unsupported text file,
parse error, unreadable entry, oversized file, or sensitive-content exclusion
prevented analysis. Policy exclusions, binary files and lockfiles do not alone
make coverage partial; their counts still appear. Complete does not mean every
language, runtime path, or repository file was understood.

Budget limits MUST NOT justify dropping eligible files silently. Chunk large
folders, shorten narrative, or fail with actionable diagnostics. Root/folder
word limits cover narrative paragraphs only; file inventories, evidence tables,
and navigation remain complete. Every semantic claim MUST cite evidence or be
explicitly labeled an inference with its basis. Missing evidence means an
uncertainty statement, not an invented explanation.

## 6. Freshness and verification

Freshness is evaluated, not assumed from a timestamp or Git commit. On verify,
rediscover the selected tree and compare paths, dispositions, readable file byte
hashes, selection policy, and generation identity against the manifest. Exact
identity and hashing rules are in [the format contract](context-format.md#freshness-identities).
Store Git HEAD only as optional provenance; committing generated output or
rebasing with identical relevant bytes MUST NOT alone make context stale.

| Result    | Meaning                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `fresh`   | Current inputs and policy match recorded identities and all owned outputs validate |
| `stale`   | A known relevant file/path/disposition/policy/identity changed                     |
| `unknown` | Inputs cannot be fully compared, for example an unreadable included file           |
| `invalid` | Manifest/output missing, malformed, modified, or internally inconsistent           |

Coverage and freshness are independent: unsupported text can yield
`fresh + partial`; unreadable content prevents a `fresh` result. A byte hash
comparison does not establish semantic truth. Verification MUST check mechanical
invariants but MUST NOT advertise hallucination detection as guaranteed.

Build MUST rediscover/recheck inputs before publication. Abort if they changed
during the run, leaving previous output intact. Incremental updates invalidate affected ancestors and summaries whose evidence or
dependency descriptions changed; see [incremental updates](incremental-updates.md)
for exact cache inputs and conservative invalidation.

## 7. Output ownership and Git policy

The format contract defines all generated files. A build MUST refuse to overwrite
an existing nonempty `context/` without a valid ownership manifest, or owned
files whose hashes no longer match. Preserve user work rather than offering an
implicit force overwrite. Store manual notes outside `context/`. To recover,
move edited/unowned output aside, then rebuild; SHContext does not delete it.

**Recommended team mode:** commit the entire generated `context/`, including
portable manifest, report and structured cache, after review, alongside source changes. Never
commit root `.shcontext/` staging/logs or credentials. Committing is a user/team
choice: local-only users can ignore `context/` and rebuild on their checkout.
The tool MUST NOT edit `.gitignore`, stage files, or commit automatically.

An assistant does not automatically consume generated Markdown. Users must
instruct their supported assistant to start with `context/CONTEXT.md`, check
freshness, follow relevant child links, and inspect source before changing code.
SHContext MUST NOT replace repository instructions such as `AGENTS.md`.

## 8. Outcomes and acceptance criteria

| Exit code | Contract                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------- |
| `0`       | Scan/build completed with complete coverage; verify found fresh, complete, valid context          |
| `2`       | Scan/build completed with explicitly partial coverage; verify found fresh, partial, valid context |
| `1`       | Operational/configuration/provider failure; verify found stale, unknown, or invalid context       |

A partial build with unreadable content may publish explicit placeholders and
exit `2`; a subsequent verify exits `1` because that content cannot be compared.
A failed build exits `1` and MUST NOT publish drafts. Diagnostics go to stderr;
no source snippets, credentials, or provider request bodies are logged by default.

The implementation is releasable only when these observable cases pass:

| Scenario                                                  | Required behavior                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Small JS/TS tree                                          | Root and every included folder have linked summaries with valid source references              |
| Dirty/untracked file                                      | Summary and hash describe current bytes, not HEAD or index                                     |
| Tracked path matches `.gitignore`                         | Included unless a stronger SHContext exclusion applies                                         |
| Nested ignore + negation                                  | Matches the documented layer and parent-pruning rules                                          |
| Ignored dependency tree or symlink                        | Single boundary record; no descent or provider content                                         |
| Python file, parser error, denied file/directory          | Explicit limitation and partial coverage; no invented behavior                                 |
| Embedded credential                                       | Whole-file exclusion without matched value in output/logs                                      |
| Add/edit/delete/move, config or parser identity change    | Verify reports stale; HEAD-only change does not                                                |
| Output edited, manifest corrupt, filename collision       | Verify/build refuse a misleading valid result                                                  |
| Source changes during generation, budget/provider failure | Previous published context remains usable; no partial replacement                              |
| No eligible text / empty directory                        | Honest inventory-only/empty summary; no fabricated features                                    |
| Same unchanged inputs                                     | Mechanical identities and ordering stable; prose need not be byte-identical                    |
| First build creates output/state directories              | Immediate offline verify is fresh; generated paths do not invalidate their own source identity |

Research references explain design inputs, not features inherited from another
tool. Tests and benchmarks must demonstrate SHContext's own behavior.
