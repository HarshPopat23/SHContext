# Code structure and dependencies

The read-only analysis API discovers a selected local root, extracts supported
syntax and configuration facts, builds a conservative file graph, and validates
the complete report. It executes no source, configuration modules, package
scripts or model calls, and writes no repository files.

```ts
import { analyzeRepository } from 'shcontext/analysis';
import { scanRepository } from 'shcontext/scanner';
const scan = scanRepository('./project');
const report = analyzeRepository('./project', {
  expectedInputId: scan.inventory.input_id,
});
console.log(report.modules, report.edges, report.entry_points);
```

`analyzeRepository` is also exported from `shcontext` and `shcontext/core`.
`expectedInputId` is optional; when supplied, a changed scan fails before
extraction. Selected files are reread with bounded, containment-checked access
and must match the scanned byte hash. A final scan must retain the same input
identity. Changes or access failures abort the operation without returning a
half-completed report. The scanner's stable-tree and concurrent-rename limitations
still apply; this is not an atomic filesystem snapshot.

The CLI `scan` command retains its inventory-only output format. Extraction is a
library pipeline stage; this change does not implement generation or an analysis
CLI command. Future generation can consume this report without inventing a
second symbol/dependency format.

## Declared syntax scope

Supported structural extensions are `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`,
`.mts`, `.cts`, including `.d.ts`, `.d.mts` and `.d.cts`. Scanner and extractor
share a fixed Babel parser dialect. Repository Babel/TypeScript plugins and
configuration are never executed. Experimental syntax outside that dialect
remains an explicit parser failure, not a recovered partial tree.

| Fact          | Extracted scope                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functions     | Function declarations/ambient signatures, directly assigned function and arrow expressions, named expressions, default-exported expressions, class/object methods and directly assigned function fields |
| Classes       | Declarations, assigned expressions and anonymous defaults                                                                                                                                               |
| Other symbols | Variable bindings including destructuring, interfaces, type aliases, enums and namespaces                                                                                                               |
| Imports       | ESM default/named/namespace/side-effect bindings, TS import-equals, TS import types, direct single-argument `require`, dynamic `import`                                                                 |
| Exports       | Module-level ESM declarations, aliases, defaults, star/namespace re-exports, TS export assignment, and direct CommonJS assignments/object-literal properties                                            |

Type assertions, `satisfies`, non-null and parenthesis wrappers preserve a direct
function/class assignment. Anonymous callbacks inside arbitrary expressions,
control-flow-derived values, computed export names, property mutation through
helpers, `require.resolve`, `module.require` and createRequire aliases are
outside the declared scope. No constant folding or execution fills those gaps.

Symbols retain stable per-file `S1` IDs in source order, inclusive line ranges,
kind, nullable name and a module-export flag. Class methods use a class-name
prefix when available. Duplicate names remain distinct IDs. Anonymous/computed
names may be null. Nested declarations are inspected but are not module exports
merely because an enclosing function/class/namespace is exported. Observed
CommonJS assignments describe syntax, not a final runtime export object.

Module records retain imported/exported names and aliases, explicit syntactic
`type_only` flags, and evidence. A flag is not a prediction of emitted JavaScript;
ambient/type-only dependencies remain file-level syntax relationships. The graph
is not a call graph, complete runtime graph or type-check result.

References carry the decoded original string specifier, or null for a computed
expression; an empty string remains an empty literal. Byte ranges cover the
whole import/export/call, are zero-based and end-exclusive, and refer to raw
UTF-8 bytes. Conversion from Babel's UTF-16 indices preserves BOMs, emoji and
CRLF/Unicode line boundaries. Evidence also identifies the source path, hash,
line range and basis. No source snippets are emitted.

Direct `require` calls are suppressed with an `uncertain_require` diagnostic when
lexically shadowed, reassigned anywhere in the file, or inside `with`. This
conservatively avoids labeling a user-defined function as a confirmed dependency.
ESM imports provide a positive control in tests; real unshadowed direct requires
are retained. Dynamic arguments and template literals are not evaluated and
remain unresolved computed references.

## File resolution policy

Every extracted reference has exactly one edge. Only a resolved edge has a
nonnull `to`; external and unresolved edges have null targets and explicit
reasons. Resolution reads inventory identities, never Node's loader, the network,
`node_modules`, repository resolver plugins or paths outside the selected root.

| Specifier                                                     | Policy                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Explicit relative filename                                    | Exact included-file match only                                                                               |
| Extensionless relative path                                   | Exact filename, JS/TS-family/JSON extensions, and `index` files with those extensions form one candidate set |
| Multiple matching candidates                                  | `unresolved: ambiguous`, without runtime-specific precedence                                                 |
| A candidate behind an excluded boundary                       | `unresolved: excluded_target`, even if another candidate is visible; descendants remain unknown              |
| Missing file                                                  | `unresolved: missing_target`; `.js` is not silently rewritten to `.ts`                                       |
| Absolute/root-escaping path                                   | `unresolved: outside_root`; no outside file is inspected                                                     |
| URL, query/fragment, percent escape or unsupported syntax     | `unresolved: unsupported_resolution`                                                                         |
| Computed import/require                                       | `unresolved: computed`                                                                                       |
| Package-internal `#`, `@/`, `~/`, or a declared TS path alias | `unresolved: alias`                                                                                          |
| Bare package syntax                                           | External package reference, without asserting installation or successful loading                             |
| Explicit `node:` namespace / recognized Node builtin          | External builtin reference, without asserting availability in a particular runtime                           |

Visible ancestor `tsconfig*.json`/`jsconfig*.json` declarations contribute alias
uncertainty. A `baseUrl`, inherited `extends`, or malformed compiler configuration
makes otherwise bare references uncertain; configuration inheritance is not
loaded. Explicit `node:` remains outside the local graph. Multiple project configs
are not assumed to identify the host's active build configuration. Bundler aliases,
package conditions, extension substitution and runtime injection remain unmodeled.

A resolved edge proves a unique included file match under this policy. It does
not prove that Node, TypeScript, a bundler or application runtime will load it.
An explicit relative import of included unsupported text can still identify a
file without permitting behavioral claims about that file.

## Configuration, entry points and fallbacks

Selected `package.json` files are inspected as strict JSON; selected
`tsconfig*.json` and `jsconfig*.json` allow JSONC comments and trailing commas.
Duplicate decoded keys, invalid syntax or excessive parser depth yield a
`configuration_uncertain` diagnostic with no accepted facts or entry declarations.
Other configuration formats keep their scanner text-level mode, with no claimed
structural configuration parser.

Configuration records retain evidence for package name/type, script names,
dependency names, selected compiler flags/options, declared path aliases,
`extends` and project-reference paths. Script bodies and dependency versions are
not copied into the report. Extends/project references are recorded, never opened.
Unknown configuration keys are not interpreted as executable instructions.

Package `main`, `module`, `types`, `typings`, `bin` and string leaves under
`exports` yield entry-point declarations with JSON-pointer selectors and evidence.
Targets use exact paths relative to that package's folder. Conditional and array
branches remain separate declarations; no active condition/fallback is selected.
Patterns stay unresolved. Missing, excluded, outside-root and unsupported targets
retain reasons and null targets. Malformed simple entry fields are not interpreted
as valid file declarations. No entry point is guessed from an `index.ts` filename.

Unsupported readable files produce a labeled `inventory-only` `FileAnalysis`:
path/hash/size from inventory, language hint, empty symbols/references and an
explicit fallback diagnostic. Supported prose/configuration keeps bounded text
inspection mode. Syntax failures retain scanner diagnostics with empty symbol
and reference arrays. Ignored, binary, oversized, generated, sensitive and
unreadable content remains represented by inventory boundaries; it is not reread
as evidence or promoted into a confirmed graph target.

## Shared report and acceptance checks

`RepositoryAnalysisSchema` and the inferred `RepositoryAnalysis` type are exported
from `shcontext/contracts` and registered as `repositoryAnalysis`:

| Field            | Producer / purpose                                                       |
| ---------------- | ------------------------------------------------------------------------ |
| `schema_version` | Version 1, strict unknown-field/version rejection                        |
| `inventory`      | Scanner identities, counts, dispositions and coverage                    |
| `components`     | Explicit parser/extractor and resolver revisions                         |
| `analyses`       | Exactly one existing `FileAnalysis` per selected readable file           |
| `modules`        | Import/export bindings for each successfully parsed structural file      |
| `edges`          | Existing `DependencyEdge` records, exactly covering extracted references |
| `configuration`  | Bounded JSON/JSONC configuration facts and uncertainties                 |
| `entry_points`   | Evidence-backed package declarations and exact file-match status         |
| `diagnostics`    | Sanitized run diagnostics                                                |

The validator checks identity, coverage, evidence basis/ranges, binding references,
unique reference-to-edge coverage and included graph/entry targets. It checks
mechanical consistency, not semantic truth or freshness on its own. Existing
manifest/summary contracts are retained. Version 1 adds the analysis report,
`external_builtin`, and empty literal specifiers; null still means computed.

Acceptance checks were written before implementation using the
[unlazy workflow](https://github.com/Leonxlnx/unlazy/blob/main/SKILL.md):

| Check                   | Observable evidence                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Symbols/exports         | `tests/extraction-symbols.test.mjs`: exact expected names/kinds/flags, aliases, scopes, anonymous defaults, dialects and raw ranges                                |
| Dependency distinctions | `tests/extraction-dependencies.test.mjs`: exact fixture edges and negative/positive controls for shadowing, ambiguity, exclusions, aliases and computed references |
| Metadata/fallback       | `tests/extraction-metadata.test.mjs`: declared selectors, configuration facts, malformed configs, absent targets and unsupported languages                         |
| Integration             | `tests/extraction-integration.test.mjs`: deterministic reports, source snapshots, changed input rejection, boundary safety and rejected fabricated records         |
| Package/regression      | `npm run check`: formatting, strict types, complete tests, installed tarball execution and independent consumer types                                              |

The task ledger additionally records manual scope review and GitHub's actual
Linux/Windows Node 22/24 CI outcomes. These remain separate from local test claims.

## Research rationale

- [Babel parser](https://babeljs.io/docs/babel-parser): explicit dialects, import
  expression nodes and non-recovering parse behavior; no repository plugins.
- [Babel traversal](https://babeljs.io/docs/babel-traverse): AST visitors and lexical
  scope inspection; tests verify shadowed/hoisted bindings against positive cases.
- [Node CommonJS modules](https://nodejs.org/api/modules.html): `require`, exports
  and runtime resolution have host rules this conservative graph does not claim.
- [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html):
  resolution depends on the host, aliases and extension substitution; unique
  syntax-based candidates must not be advertised as runtime equivalence.
