# Repository scanner

`shcontext scan <directory>` discovers current working-tree content and prints a
version-1 `RepositoryInventory` JSON document on stdout. It makes no model calls
and creates no files. The directory is required; quote paths containing spaces.

```sh
npm ci
npm run cli -- scan .
# After npm link:
shcontext scan ./my-project
```

Diagnostics and one completion line go to stderr. Exit codes are `0` for complete
coverage, `2` for a usable partial inventory, and `1` for operational or
configuration failure. Failure produces no inventory on stdout. Consumers must
check the status rather than treating every nonzero exit as unusable JSON.

```ts
import { scanRepository, ScanError, type ScanResult } from 'shcontext/scanner';
const result: ScanResult = scanRepository('./my-project');
console.log(result.inventory.coverage);
```

The synchronous API returns `inventory`, the effective `configuration`, sorted
`control_files` with raw-byte hashes or explicit nulls, `policy_id`, and installed
scanner component `versions`. These additional library fields prepare the
manifest handoff; CLI stdout contains only the shared inventory schema. Imports
perform no discovery. Filesystem failures throw a `ScanError` with a stable
`code`, nullable root-relative `path`, and sanitized `message`.

## Selection and Git

The [specification](specification.md#3-file-eligibility-and-exclusions) defines the
ordered policy. Mandatory boundaries and filename/noise exclusions precede
repository `.gitignore`, then root `.shcontextignore`, then content gates.

- Root `context/` and `.shcontext/` are fixed `policy_exclusions`, never counted
  observed entries. Their existence or contents do not change `input_id`.
  A symlink there fails the scan; case variants of reserved names fail as
  collisions. Nested folders named `context` are ordinary source folders.
- Symlinks, junctions, dangling links and cycles are recorded without following
  targets. Their record uses `kind: file`, because no target type is inspected.
  Real excluded directories have a trailing slash and no enumerated descendants.
- `.git`, `.hg`, and `.svn` are metadata boundaries at any depth. A nested `.git`
  directory/gitfile or an indexed Git submodule makes its real parent directory
  a `nested_repository` boundary, even for an uninitialized submodule.
- Nested `.gitignore` patterns use case-sensitive Git-style matching. Tracked
  files bypass this layer, retaining necessary ancestors of ignored folders.
  Untracked siblings remain excluded. Root `.shcontextignore` applies equally
  to tracked files, and its negations cannot override earlier layers.
- A selected subdirectory is its own analysis root: parent ignore files do not
  expand its source inputs. Git index metadata can establish tracking status.
  `.git/info/exclude` and global exclusions are deliberately not selection rules.
- Git is required when a `.git` marker exists at the root or an ancestor. Its
  index is read with `ls-files --stage -z`; hooks, filters and source programs
  are not run, optional locks and fsmonitor are disabled, and inherited `GIT_*`
  index/worktree/config overrides are removed. Tracking failure aborts instead
  of silently treating tracked files as untracked. Ordinary directories require
  no Git executable. A bare Git database is not a supported checkout root.

Only discovered paths are counted. Limits include the root and boundary records,
never guessed descendants. UTF-8 byte ordering makes traversal and output
stable. Nonportable names, invalid UTF-8 names and case-folding collisions fail
explicitly instead of producing ambiguous output paths.

## Content gates and limits

Root `shcontext.config.json` uses the defaults and keys in the
[specification](specification.md#2-inputs-and-configuration). It is strict JSON:
required `version: 1`, no comments, trailing commas, duplicate keys at any depth,
unknown keys, coercion, executable configuration, or provider endpoints.

Selection-control files must be regular readable UTF-8 text, with no NUL, at
most 1 MiB each, and pass credential screening. This fixed bootstrap ceiling also
applies before configuration is known. Controls are read even if excluded from
the content inventory. All discovered nested `.gitignore` files are identified;
absent root controls have null identities. Unreadable, symlinked, malformed or
credential-bearing controls abort selection. Controls are rechecked before
returning, including those excluded from inventory.

Individual content files use `maxFileBytes` (default 1 MiB). Oversized files get
`too_large` and partial coverage. `maxEntries` (default 10,000) and
`maxInputBytes` (default 20 MiB) abort the whole scan, never truncate silently.
The byte budget includes readable selected text before credential/generated
filtering, including unsupported languages and parse failures. Lockfiles,
source maps, known binary extensions, and oversized files are excluded before
text reading; they do not contribute text bytes. Bounded reads check size again
and stop after the per-file ceiling plus one byte.

| Input                                                   | Result                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| Common image/archive/font/media/executable extensions   | `skipped: binary` without decoding                         |
| NUL-containing bytes                                    | `skipped: binary`                                          |
| Invalid UTF-8                                           | `skipped: non_utf8`                                        |
| Lockfiles and `*.map`                                   | `skipped: lockfile` / `source_map`                         |
| `*.min.js`, `*.min.css`, or recognized generated header | `skipped: generated_code`                                  |
| Credential-pattern match                                | `skipped: sensitive_content`, partial, no digest           |
| Supported JS/TS                                         | Local Babel syntax validation; `analyzed` or `parse-error` |
| Supported prose/configuration                           | `analyzed` at the declared text level                      |
| Other readable text                                     | `inventory-only: unsupported_language`, partial, hashed    |
| Denied/read-failed file or directory                    | `unreadable`, partial, sanitized error code                |

The binary-extension list lives in `src/scanner/index.ts`; an unknown extension
still undergoes NUL/UTF-8 gates. Generated-code detection is deliberately narrow:
a recognized comment header in the first 4 KiB (`@generated`, `Code generated …
DO NOT EDIT`, or `auto-generated … do not edit`) or a minified filename. It does
not infer generation from formatting, `.gitattributes`, or dependency graphs.
Generated files are declared exclusions and do not alone make coverage partial.

The versioned local credential detector recognizes private-key headers and
specific AWS access-key, GitHub-token and Groq-token shapes. Filename exclusions
apply first. This is a conservative pattern check, not a complete secret audit;
unknown credentials and false positives remain possible. No matches, snippets,
or sensitive-content hashes are returned. A control-file match aborts rather
than persisting its hash. Provider configuration is validated and preserved by
the library but never contacted; no provider SDK is installed.

Babel parser 7.29.9 is pinned to retain the project's Node 22.14+/24 compatibility.
JSX is enabled for `.jsx`/`.tsx`, TypeScript for TS-family extensions including
ambient declarations, module mode for `.mjs`/`.mts`, CommonJS for `.cjs`, and
unambiguous mode otherwise. No repository Babel/TypeScript configuration or
plugins are loaded. This checks the documented syntax dialect, not types,
module resolution, runtime behavior, source symbols, or dependency edges.
Configuration/text mode does not promise to parse arbitrary configuration
formats. Parser diagnostics intentionally omit source excerpts.

## Identity, consistency, and limits

The scanner computes `policy-v1` and `input-v1` exactly as defined in the
[format contract](context-format.md#freshness-identities): ordered tuple JSON,
raw-byte SHA-256, explicit nulls, effective configuration and control identities.
No absolute root, clock, Git HEAD or generated bytes participate. The policy and
detector revisions are explicit. Equal identities describe the recorded
mechanical scope; they do not certify semantic correctness or unreadable bytes.

Reads recheck path ancestors, canonical containment, regular-file identity,
size and modification metadata. Files are opened read-only, nonblocking, with
`O_NOFOLLOW` where the platform supports it; descriptors close in `finally`.
Directories are listed without following link entries. Detected file/control
replacement fails the run. There is no filesystem snapshot or cross-platform
atomic directory-descriptor traversal: use a stable working directory, not a
tree concurrently mutated by an adversary. A later build must rediscover before
publication. Discovery itself never writes source, output, index, or config.

## Research and verification

The implementation decisions follow primary sources:

- [Git ignore manual](https://git-scm.com/docs/gitignore): tracked-file exception,
  nested precedence, negation and excluded-parent pruning.
- [Git ls-files](https://git-scm.com/docs/git-ls-files): NUL-delimited index records,
  stages and submodule mode; metadata is distinct from working-tree bytes.
- [node-ignore](https://github.com/kaelzhang/node-ignore): tested Git-style matcher;
  explicit case-sensitive matching avoids its default case-insensitive setting.
- [Node filesystem API](https://nodejs.org/docs/latest-v22.x/api/fs.html): link
  inspection, descriptor operations and platform limits of open flags.
- [Babel parser](https://babeljs.io/docs/babel-parser): syntax dialect options and
  strict error behavior without repository configuration.
- [jsonc-parser](https://github.com/microsoft/node-jsonc-parser): strict parse
  options and an object tree that permits decoded duplicate-key detection.

Tests copy a small repository and compare every expected inventory reason,
source hashes, repeated identities and before/after filesystem snapshots.
Additional real Git fixtures exercise forced tracked files, nested negation,
submodules, selected subdirectories, and deliberate global/info exclusions.
Symlink, FIFO, filename and denied-access tests use host capabilities; platform
skips are explicit. The package consumer test runs scan from the installed
local tarball and checks its independently compiled TypeScript API.
