# SHContext architecture

Status: implementation plan for the [v0.1 specification](specification.md), not
an existing module inventory. The [format contract](context-format.md) is the
authority for persisted files, identities, and diagnostics.

The shared in-memory/runtime record contracts are now implemented in
`src/core/contracts/`; use the [data contract guide](data-contracts.md) for exact
types and payloads. Processing stages below remain the implementation plan.

## Design decisions and research

These decisions are SHContext proposals. Existing projects inform them; their
features are not evidence that SHContext has implemented equivalent behavior.

| Research input                                                                                     | Observation                                                                   | SHContext decision                                                                                        |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Aider repository map](https://aider.chat/docs/repomap.html)                                       | Maps important symbols and ranks file relationships within a token budget     | Preserve symbols and dependency evidence; use maps for navigation, not as proof of behavior               |
| [Repomix configuration](https://repomix.com/guide/configuration)                                   | Separates selection/exclusions from packed output and supports bounded inputs | Make inventory and exclusion reasons explicit before generation                                           |
| [Repomix security](https://repomix.com/guide/security) and [FAQ](https://repomix.com/guide/faq)    | Uses credential checks and recommends reviewing output                        | Apply filename exclusions and local detection before provider submission; disclose limits                 |
| [Git ignore rules](https://git-scm.com/docs/gitignore)                                             | Tracked files are not removed by ignore patterns                              | Separate Git tracking from SHContext's stricter exclusions; exclude personal global rules for portability |
| [Tree-sitter introduction](https://tree-sitter.github.io/tree-sitter/)                             | Syntax trees can remain partially available around errors                     | Treat syntax recovery as incomplete evidence; report parser errors explicitly                             |
| [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html) | Resolution behavior varies with host and configuration                        | Limit v0.1 edges to explicitly resolved relative references and report ambiguity                          |

More languages and embeddings remain later extensions. The first four-role
workflow and bounded asynchronous folder execution are now implemented; see
[execution roles](agents.md). They
must preserve selection, output ownership, provenance and partial-coverage rules.
No vector database, hosted service, MCP server, or parallel scheduler is required
for the first useful build.

## Boundaries and target modules

Use a TypeScript core with a thin CLI; select exact dependencies when building
the relevant modules, pin versions, and test their behavior against this contract.

| Proposed location | Responsibility                                                                     | Must not do                                           |
| ----------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/cli/`        | Parse commands, select root, render diagnostics, map exit codes                    | Hide partial failures or publish directly             |
| `src/core/`       | Config/schema validation, shared types, budgets, pipeline state                    | Evaluate repository configuration code                |
| `src/scanner/`    | Enumerate paths, track Git status, apply layered policy, hash safe input           | Follow symlinks or silently prune for budget          |
| `src/parsers/`    | JS/TS syntax adapters and bounded text/config inspection                           | Claim complete type/call/runtime knowledge            |
| `src/graph/`      | Store evidence-backed relative edges, unresolved/external references               | Invent targets for aliases/dynamic references         |
| `src/generation/` | Evidence selection, chunking, bottom-up summaries, rendering                       | Let a model select arbitrary filesystem paths         |
| `src/providers/`  | One initial adapter; request limits, bounded retries, response decoding            | Read repository files or select fallback destinations |
| `src/validation/` | Format, path, evidence, coverage, identity and output checks                       | Promise semantic truth from hash/link validity        |
| `src/query/`      | Offline path/symbol/text/summary retrieval, graph navigation and source inspection | Hide stale/missing context or write source            |
| `src/agents/`     | Bounded role scheduling, reservations, cancellation and source review              | Give folder workers independent output ownership      |
| `src/storage/`    | Staging, ownership checks, recoverable publication                                 | Delete unowned output or modify source                |
| `tests/fixtures/` | Small controlled repositories covering edge cases                                  | Require real credentials for core tests               |

Selection and hashing are deterministic code, not model tasks. Model calls are
restricted to bounded supplied evidence. A separate semantic reviewer can later
inspect source, but cannot replace mechanical checks or human evaluation.

## Shared in-memory contracts

| Record               | Minimum responsibility                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `EffectiveConfig`    | Validated settings, provider/model ID, component identities; no credentials in serialized form      |
| `InventoryEntry`     | Path/kind, one disposition/reason, mode, byte size, digest, sanitized diagnostics                   |
| `FileAnalysis`       | Inventory reference, syntax symbols, evidence ranges, observed references, limitations              |
| `DependencyEdge`     | From/to paths when resolved, original specifier, relationship kind, evidence; no guessed target     |
| `FolderSummary`      | Required sections, claims with evidence IDs, direct file/child inventory, complete/partial coverage |
| `GenerationManifest` | Portable source/policy/generation identities and owned output digests                               |
| `VerificationResult` | Fresh/stale/unknown/invalid state, coverage, machine-readable findings                              |

Adapters MUST return typed results validated by the core. Provider responses
cannot introduce a source reference outside the supplied evidence set. Invalid
responses get at most one repair request; persistent failure aborts publication.
Do not accept a string that merely looks like Markdown as a valid folder draft.

## Processing stages

### 1. Preflight and source inventory

Resolve the user-selected root, validate strict configuration, check output/state
ownership and collisions, and discover paths without following symlinks. In Git
mode, use tracked status and current filesystem entries, including untracked
files. Use argument arrays and NUL-safe Git output, never a shell-interpolated
path. Git is a metadata aid; do not invoke hooks or fetch network content.

Read ignore-control files, apply policy and record pruned boundaries. Discovery
always omits the reserved output/state roots themselves;
report them as policy exclusions, not new source entries after the first build.
Hard size and entry limits are checked before provider work. A readable source file that
changes or disappears while read is a source-race failure, not an opportunity
to silently exclude it. Ordinary access failures are explicit unreadable entries.

For content candidates, perform local credential-pattern checks, then hash and
retain safe text in process memory for this run. Do not persist a raw-source
cache in v0.1. Source containing credentials is discarded from model input and
portable digests. The inventory itself may contain paths and needs output review.

### 2. Analysis and graph construction

Parse supported source, retain byte/line mappings, extract symbols and literal
references, then resolve relative edges conservatively. Candidate extension order
is `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, followed by
`index` with those extensions. Explicit existing relative file paths are accepted
as observed file references, including supported text/configuration files.

For an extensionless target, gather all candidates and accept only a unique
match; the order is for stable reporting, not guessing which runtime would pick.
Do not substitute `.js` with `.ts`, evaluate package exports, infer workspace
packages, execute aliases, or resolve outside root in v0.1. A target excluded by
policy is an unresolved reference with `excluded_target`, never a content read.
An inventory-only target may be named as an observed reference without claims
about its behavior. External/bare and computed references remain visible.

Import relationships, re-exports, and literal `require()` are evidence categories,
not a complete function call graph. Syntax errors produce `parse-error` entries,
even if partial nodes were recovered. Tree-sitter is a suitable parser candidate;
exact grammar/query versions belong in generation identity if selected.

### 3. Generation from leaves to root

For each included folder, provide direct supported files, relevant inspected
dependency evidence, child summaries and coverage, and the required output
schema. Unsupported text and parse-error content never enter a provider request
in v0.1; only their path/disposition limitations are supplied.
File names and extracted declarations alone cannot support behavioral claims;
read the relevant bodies within allowed inputs.

For a large folder, process evidence in bounded chunks and retain claim/evidence
associations through synthesis. All direct files remain in the rendered inventory.
The orchestrator tracks which source ranges were inspected; uninspected behavior
must remain unstated. No silent truncation. If bounded synthesis cannot satisfy
coverage and schema, return a failure and actionable budget diagnostic.

Each provider request MUST fit its configured model context and response limits;
reserve output capacity before sending. Pin the provider adapter's tokenizer or
use an explicitly conservative estimate with headroom; report estimates as such.
The adapter MUST expose finite request timeout, maximum attempts, input/output
token ceilings per request and per run, and cancellation. Defaults are part of
the chosen adapter's future documented contract, not guessed universal model
limits. Validate them before the first call. Never exceed a run ceiling through
retries. Respect rate limits; after at most three total attempts per request,
surface failure rather than changing models. The one schema-repair request is
separate but is also charged against the same run ceilings.

Folders with no analyzable text receive deterministic empty/inventory-only
summaries and need no provider call. Parent summaries propagate all partial
coverage and link child context. A root synthesis supplies the architecture
overview through the Architecture Analyst role; it does not require another
independent writer or an extra model destination.

### 4. Validation and publication

Validate the structured drafts, evidence ranges/hashes, complete file/child lists,
word limits, encoded links, disposition counts and output schema. The renderer,
not the model, produces metadata and owned paths. Generated narrative is data:
it cannot run commands or change selection/provider policy.

Rediscover selection and compare relevant source hashes and identities with the
initial snapshot immediately before publication. This catches ordinary concurrent
edits; it is not a transactional filesystem snapshot against a malicious writer.
For strict reproducibility, the caller uses a quiescent checkout. If relevant
inputs changed, exit with failure and retain the previous output.

Stage all new output under root `.shcontext/`, then publish through one writer.
Do not claim that rewriting many files is a single atomic operation. Use a
transaction journal and a recoverable directory-swap strategy on the same
filesystem: preserve old `context/` as a backup, move the validated staged tree
into place, validate it, then remove only the owned backup. Lock concurrent
builds; root/state/output symlinks and unexpected entries abort the operation.
The journal records phases and owned paths but no source bodies or credentials.

Verify MUST treat an active/incomplete publication as invalid. On the next build,
recover only journal-owned paths: restore the old output if publication was not
validated, or finish cleanup if the new output was validated. If ownership is
uncertain, stop and request manual recovery rather than deleting files. A failed
generation before publication never alters the old context; a publication crash
must leave either a valid tree or enough owned state to restore it.

### 5. Verification without generation

Verify validates existing schema/ownership first, rediscovers current input with
the same scanner, recomputes policy/input/generation identities and applies the
precedence defined in the format contract. It checks stored output hashes and
reference bounds against matching source identities; changed source is stale,
not automatically corrupt output. It needs neither provider access nor old local caches. The installed CLI
knows component versions and can compare recorded model/config IDs offline.

Do not rewrite prose, "repair" the manifest, or accept a matching Git HEAD as
proof of freshness. Verify is intentionally usable on a clone containing only
source, configuration, and committed generated context.

## Incremental updates, queries and execution roles

Implemented `update` reuses the same inventory and evidence contracts. Changes must
invalidate the file's folder, affected ancestors and reverse evidence/dependency
consumers. Moves/deletions remove only owned obsolete output. Cyclic imports do
not require recursive generation: graph construction precedes folder synthesis.
Complete folder-input hashes drive bottom-up reuse, and a versioned structured
cache preserves claim boundaries. See [incremental updates](incremental-updates.md)
for exact invalidation, migration and optional Git move hints.

Four runtime roles now map to existing stages: Coordinator, Folder Analyst,
Architecture Analyst and Verifier. Sequential execution is the default; an opt-in
bounded async pool overlaps disjoint folder model requests by depth. Parent
records wait for children, and one writer owns staging/publication. Optional model
review inspects claims and model-authored limitations against supplied source,
without certifying correctness. Request/token and caller-priced spending
reservations cover all attempts. See [roles and limits](agents.md).

[Context querying](querying.md) performs offline path/symbol/text/summary search,
bounded resolved graph traversal and current source inspection. It checks context
freshness, labels stale/missing/invalid/unknown results and never silently rebuilds.
There is no embedding/index service or provider call in this first query workflow.
Skill packaging and an optional MCP integration remain separate later work.

## Implementation and verification order

| Order | Deliverable                                             | Evidence needed before advancing                                                                                    |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1     | Config, shared schemas, path rules, scanner             | Fixtures for tracked/untracked files, ignore precedence, unusual paths, pruned boundaries and limits                |
| 2     | Parser adapters and graph                               | Symbols and resolved/unresolved edges checked against small JS/TS examples; error/declaration cases                 |
| 3     | Renderer and deterministic inventory-only build         | Every included folder represented; metadata/links/ownership verified without a model                                |
| 4     | Provider adapter and sequential semantic generation     | Mocked timeout/budget/schema failures; real sample summaries manually checked against evidence                      |
| 5     | Publication and offline verify                          | Race, output-tampering, interrupted-swap recovery and clean-clone verification exercises                            |
| 6     | Incremental update                                      | Exact changed-folder sets, zero-request no-op, cache invalidation and ownership-safe deletion tests                 |
| 7     | First release and build/verify skills                   | Specification acceptance matrix satisfied and limitations documented                                                |
| Later | Query/role quality studies, embeddings, skill packaging | Compare correctness, useful file retrieval, latency, token use and cost against sequential/simple-summary baselines |

Tests must cover the product's observable contracts, not just snapshots of its
own implementation. Include binary-only/empty folders, unsupported files,
unreadable boundaries, poisoned instructions in comments, invalid generated
references and deliberately false but well-linked prose. The last case must
demonstrate the limit: mechanical verification cannot establish semantic truth.

The present documentation change does not implement these tests or claim a
working release. Implementation pull requests must add the relevant checks as
each contract becomes executable.

## Implemented discovery

The [scanner](scanner.md) implements discovery and content gates through the
shared inventory boundary. It computes policy/input identities and exposes
selection metadata for later manifests. Its local syntax validation does not
implement the planned symbol extractor, dependency graph or context generator.

## Implemented structural handoff

`src/core/analyze-repository.ts` composes discovery, checked source reads, JS/TS
extraction, bounded configuration inspection and conservative graph construction.
It exports a validated `RepositoryAnalysis` for later evidence/generation stages.
See [code structure](code-structure.md) for declared syntax, exact dependency
rules, entry-point declarations and unsupported/unresolved cases.

## Implemented first build

`buildRepository` and `shcontext build` now compose the scanner and analysis APIs,
checked evidence reads, sequential leaf-to-root synthesis, one bounded OpenAI
adapter, structured validation, Markdown rendering and recoverable publication.
See [generation](generation.md) for operating limits and recovery boundaries.
Oversized requests fail without truncation; large-folder chunking remains planned.
[Offline verification](verification.md) now checks output integrity and freshness
with a separate source-review boundary. Live-provider quality evaluation is blocked
until host credentials are supplied; controlled-provider tests do not prove it.
