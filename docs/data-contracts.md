# Shared data contracts

The first executable record contracts live in `src/core/contracts/`. Scanner,
parser, graph, generator, updater and verifier code must import these definitions
rather than defining parallel interfaces. All top-level records require
`schema_version: 1`; the package version remains `0.0.0` during development.

This milestone implements data validation, not scanning, generation, filesystem
verification, fingerprint computation or configuration-file loading. The CLI
still exposes help/version only. The [specification](specification.md) and
[context format](context-format.md) describe the eventual product.

## One definition for types and runtime validation

Each named schema is a strict Zod object or discriminated union; each TypeScript
type is inferred from it. Unknown fields are rejected, never silently stripped.
Numbers, booleans and nulls are not coerced, and missing fields are not defaulted.
An explicit null means unknown/absent as documented; it is not equivalent to
omitting a required key. All integer fields are bounded by JavaScript's safe
integer range. Version strings are nonempty component identifiers, not necessarily
semantic versions: a parser query set or template can have its own revision ID.

The schemas are exported from `shcontext`, `shcontext/core` and the focused
`shcontext/contracts` entry point. The public type names are `RepositoryInventory`,
`FileAnalysis`, `ExtractedSymbol`, `DependencyEdge`, `FolderSummary`,
`SupportingEvidence`, `GenerationManifest`, `ValidationFinding`,
`VerificationResult`, `EffectiveConfig` and `ContractBundle`.

```ts
import {
  validateContract,
  type FileAnalysis,
  type DependencyEdge,
} from 'shcontext/contracts';

export function receiveAnalysis(input: unknown): FileAnalysis {
  const checked = validateContract('fileAnalysis', input);
  if (!checked.success) {
    throw new Error('Invalid file analysis; inspect checked.findings.');
  }
  return checked.data;
}

export function target(edge: DependencyEdge): string | null {
  // The discriminator narrows to a non-null target only in this branch.
  return edge.resolution === 'resolved' ? edge.to : null;
}
```

Individual schemas also expose `.parse()` and `.safeParse()` for internal code.
Use `validateContract` for a stable, value-free finding format at untrusted data
boundaries; do not log arbitrary parser exceptions. It returns either
`{ success: true, data }` or `{ success: false, findings }`. Failed validation
never returns a partially accepted payload. Finding pointers use JSON Pointer
escaping and refer to the submitted record, not the filesystem.

## Record ownership and handoffs

| Record / schema                                        | Producer              | Consumers                    | Required information                                                                                                                      |
| ------------------------------------------------------ | --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `RepositoryInventorySchema`                            | Scanner               | All later stages             | Snapshot ID, observed entries/dispositions/reasons/modes/digests, per-kind counts, coverage, diagnostics and reserved policy exclusions   |
| `FileAnalysisSchema`                                   | Parser/text inspector | Graph, generator, verifier   | Source path/hash, logical line count, language/mode/disposition, symbols, raw references and diagnostics                                  |
| `DependencyEdgeSchema`                                 | Resolver              | Generator, updater, verifier | Source reference identity, explicit resolved/external/unresolved discriminator, target or null, and reason                                |
| `FolderSummarySchema`                                  | Generator             | Renderer, updater, verifier  | Snapshot/generation IDs, subtree counts/coverage, structured sections and claims, direct files, children, tests, limitations and evidence |
| `GenerationManifestSchema`                             | Pipeline/renderer     | Updater, verifier, storage   | Effective configuration, controls, component versions, source identities, directory coverage, owned output hashes and analysis failures   |
| `ValidationFindingSchema` / `VerificationResultSchema` | Validators/verifier   | CLI and integrations         | Stable code, severity, nullable path, pointer/message; separate freshness state and coverage                                              |

The renderer fills inventories, counts, paths, IDs and other mechanical
metadata. Model-generated claims cannot supply arbitrary output paths. The
updater compares complete folder inputs, manifests and evidence/dependency consumers; it
must not reinterpret absence of a field as successful analysis.

## Entry, location and claim rules

Inventory directory paths end in `/`, except root `.`. Folder summary paths do
not have a trailing slash. Source paths reject absolute paths, colon/backslash,
dot traversal, empty segments, control characters and malformed Unicode. Root
`context/` and `.shcontext/` (including case variants) are reserved and only appear in the fixed
`policy_exclusions` tuple, not observed entries. Folder names that collide with
`CONTEXT.md` are rejected. Actual filesystem aliases/symlinks and platform-specific
name collisions still require scanner/storage preflight; data validation cannot
resolve real paths. Unicode spelling is preserved, not normalized.

Observed entries have one disposition and a compatible reason/mode. Readable
selected text needs a digest and known size; excluded and unreadable bytes cannot
carry a digest. A symlink is a leaf `kind: file` record with `skipped: symlink`,
even if its target would be a directory; the target is not followed. Ignored or
unreadable directory boundaries cannot have invented observed descendants.

Symbols use file-local `S1`-style IDs and 1-based inclusive line ranges. Logical
line count is zero for empty text; a trailing line terminator does not introduce
another content line, and CRLF is one separator. References also record 0-based,
end-exclusive UTF-8 byte offsets so two references on one line remain distinct.
Byte/line bounds are checked against recorded metadata, not fresh source reads.
Unsupported or parser-failed files cannot carry symbol/reference facts.

Dependency edges preserve the raw reference and its evidence. A resolved edge
has a non-null included source candidate as target and a null reason. External
or unresolved edges have null targets and explicit reasons. No graph edge can
invent a reference that the parser did not observe, and none can silently omit
an observed reference in a complete handoff bundle. A resolved file relationship
is not a runtime call graph.

Evidence IDs such as `E1` are local to a folder. Each evidence record includes a
source path/hash, line range, nullable symbol and basis (`source`, `configuration`
or `documentation`). Every claim cites one or more IDs. An inference additionally
requires a nonempty rationale; an observed claim has a null rationale. Missing
sections are represented by empty arrays, which the future renderer labels
`None observed`/`Not established`. File and test responsibilities must cite their
own inspected file. Tests always record `execution: not-run` because analysis
does not execute repository tests.

## Manifest decisions

The exact manifest example is embedded in the linked bundles below. Required
fields are `schema_version`, `generator`, `generation`, `selection`, `input_id`,
`coverage`, `provenance`, `files`, `directories`, `outputs`, `analysis_failures`
and `diagnostics`.

- `generator` records package version and generation ID. `generation` records
  provider/model and generator, parser, resolver, prompt, template, renderer,
  detector and default-policy revisions. Generator/provider identities must agree
  with their corresponding version/configuration fields.
- `selection.configuration` is the complete effective configuration from the
  specification, without credentials or endpoints. This schema validates a value;
  a future loader must reject duplicate keys in raw JSON before decoding and
  apply defaults. Contracts do not load config or authorize providers.
- `selection.control_files` records sorted paths and raw-byte digests or explicit
  nulls for absent controls. Root `.gitignore`, `.shcontextignore` and
  `shcontext.config.json` always have identities; discovered nested `.gitignore`
  controls are added by the scanner. The bundle checks matching readable control
  digests, but cannot independently discover controls.
- `files` records every selected text/access-failure/oversized/sensitive-content
  candidate's path, hash or null, disposition, reason and mode. Binary/policy
  exclusions remain in the inventory report. `analysis_failures` preserves one
  primary limitation per affected path, including unsupported languages,
  unreadable boundaries, parser errors and content-gate failures. Detailed safe
  diagnostics remain in inventory/analysis records.
- `directories` covers every included folder, including unreadable placeholders.
  `outputs` covers their summaries and the portable report. The manifest never
  hashes itself. Missing/duplicate output paths and case collisions are rejected.
  `provenance.git_head` is nullable informational provenance, not proof of freshness.

Path-keyed collections use UTF-8 byte order and unique identities. Evidence and
symbol IDs are unique within their own scope; a reference is identified by its
file, kind, specifier, byte range and supporting source span. Raw source bytes
are never embedded in these records. Caller-supplied strings can still contain
sensitive data: validating a record is not secret detection or redaction.

## Validation levels and limitations

1. Individual schemas validate shape and local invariants, such as line ordering,
   entry counts, mode/disposition agreement and local evidence-ID resolution.
2. `validateContract('bundle', input)` additionally checks all six handoff record
   families together: source hashes/ranges/modes, graph/reference coverage,
   direct file/child lists, aggregate folder coverage/counts, manifest identities,
   failure accounting and owned output sets.
3. A future filesystem verifier must recompute identities, inspect source/output
   bytes and detect freshness changes. Contract validation performs no I/O and
   cannot establish freshness, digest correctness, complete file discovery,
   actual parser behavior or factual accuracy of prose. A consistent forged
   snapshot can pass data validation. Never convert `success: true` into
   `fresh: true` without the separate verification procedure.

`VerificationResult` can represent `fresh + partial`; fresh results cannot contain
error findings. Non-fresh results require error findings. Codes cover contract
invariants as well as future source/selection/generation changes, unreadable
inputs, missing/modified outputs and invalid manifests. The eventual verifier
must apply the specification's invalid/stale/unknown/fresh precedence.

These are runtime Zod contracts with cross-record refinements. This milestone
does not export a JSON Schema claiming to reproduce arbitrary peer-record
equality, graph membership or coverage checks. A future JSON Schema export must
document its structural subset and retain the relational validation layer.

## Examples, tests and evolution

- [Complete handoff bundle](examples/contracts/complete-bundle.json).
- [Partial bundle with unsupported Python](examples/contracts/partial-bundle.json).
- [Verification result and finding](examples/contracts/verification-result.json).

The complete example's source hashes match `tests/fixtures/simple-repository/`
bytes. Fixture `index.ts` deliberately references an explicit `.ts` source path
to illustrate conservative resolution, not Node runtime execution. The partial
example adds a controlled Python record. Input/generation IDs and output hashes
are illustrative; no generated files or cryptographic verification are implied.
Tests load these same documented examples and mutate them to exercise failure
cases. The packed-package test also verifies runtime imports and type narrowing
from a separate consumer installation.

Version 1 is the first executable data contract; no repository context artifacts
have been generated by SHContext yet. This makes the previously proposed manifest
shape concrete, including required failure accounting and folder counts. Future
breaking field/meaning changes require a schema-version change and an explicit
migration/rebuild policy, never silent acceptance of newer records.

## Research basis

| Primary source                                                                                     | Design consequence                                                                                    |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Zod basic usage](https://zod.dev/basics) and [schema API](https://zod.dev/api)                    | Infer static types from the runtime schemas, use strict objects, and validate external unknown values |
| [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)              | Use discriminated unions for dependency resolution and validation outcomes                            |
| [JSON Schema object semantics](https://json-schema.org/understanding-json-schema/reference/object) | Make required/null behavior and rejection of additional fields explicit                               |
| [Zod JSON Schema conversion](https://zod.dev/json-schema)                                          | Do not present a structural export as a replacement for relational checks                             |

The [repository scanner](scanner.md) now implements the scanner handoff through
`scanRepository(root)`. Its extra selection metadata prepares the manifest while
CLI stdout remains the `RepositoryInventory` schema. Version 1 also recognizes
`skipped: generated_code` as a declared, non-partial policy exclusion.

The [code structure stage](code-structure.md) exports `RepositoryAnalysisSchema`
and `RepositoryAnalysis` as the `repositoryAnalysis` contract: inventory plus
file analyses, module import/export bindings, graph edges, configuration facts
and package entry declarations. Existing `FileAnalysis` and `DependencyEdge`
records are reused. Explicit builtin references use `external_builtin`; empty
literal specifiers remain strings and fail resolution rather than being mislabeled
computed. Module bindings retain `reference_start_byte` joins and source evidence.

The version-1 owned output path set also permits optional
`context/.shcontext/cache.json`. Its strict `IncrementalCacheSchema` is shared by
the generator, updater and ownership reader in `src/update/cache.ts`, reusing
`FolderSummarySchema` rather than defining a second summary format. See
[incremental updates](incremental-updates.md) for the persisted cache and migration.
