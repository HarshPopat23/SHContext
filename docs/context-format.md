# Generated context format

Status: v0.1 output contract, schema version `1`; the first [generator](generation.md)
is implemented. Product scope and selection rules are in [the specification](specification.md);
processing responsibilities are in [the architecture](architecture.md).

## Layout and path mapping

| Source directory | Generated summary               |
| ---------------- | ------------------------------- |
| `.`              | `context/CONTEXT.md`            |
| `src`            | `context/src/CONTEXT.md`        |
| `src/auth`       | `context/src/auth/CONTEXT.md`   |
| `tests/auth`     | `context/tests/auth/CONTEXT.md` |

Emit one summary per included directory, even when it contains no analyzable
files. Root output also contains `context/.shcontext/manifest.json` and
`context/.shcontext/report.json`. New builds also include owned structured
`context/.shcontext/cache.json`; see [incremental updates](incremental-updates.md). Root `.shcontext/` in the source tree is
reserved/excluded operational state, so its mirrored name cannot collide with
portable metadata. No source file is copied into the generated tree.

Paths in metadata are root-relative, use `/`, preserve case and Unicode spelling,
and never contain `..`, absolute prefixes, NUL, or platform drive prefixes. Root
is `.`. Directory records use trailing `/` except root. Reject undecodable file
names, control characters, case-folding output collisions, and directory names
that would collide with a generated `CONTEXT.md`; report `path_collision` or
`unsupported_path` and abort before writing. Do not silently rename folders.

Markdown links are relative to the generated document and URI-encode path
segments. Thus `context/src/auth/CONTEXT.md` links to source `src/auth/login.ts`
as `../../../src/auth/login.ts`. Metadata still stores `src/auth/login.ts`.
Local line anchors are optional navigation hints; structured line ranges and
source hashes are authoritative. Reject unsafe schemes and escape filenames
and model text before rendering Markdown. Model output cannot choose paths.

## Required summary content

Every `CONTEXT.md` MUST have this front matter, followed by the sections below.
The renderer supplies metadata; the model does not invent hashes or paths.

```yaml
---
schema_version: 1
source_path: 'src/auth'
coverage: 'complete'
input_id: 'sha256:<64 lowercase hexadecimal characters>'
generation_id: 'sha256:<64 lowercase hexadecimal characters>'
---
```

The angle-bracket values above describe the grammar, not literal valid digests.
`coverage` is `complete` or `partial`. `source_path` has no trailing slash.
No `fresh: true` field is stored: freshness must be checked against current input.
`input_id` identifies the full selected repository snapshot; `generation_id`
identifies the transformation. Updates can reuse narrative while rebinding this
metadata to the new snapshot.

| Required heading                 | Required content                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `# Context: <source_path>`       | Exact folder identity, including `.` for root                                                            |
| `## Purpose`                     | Bounded explanation; observed facts and labeled inferences                                               |
| `## Files and responsibilities`  | Every direct non-ignored file, its mode/disposition, and supported responsibility or explicit limitation |
| `## Interfaces and entry points` | Observed exports/routes/commands with evidence; unknowns stated                                          |
| `## Dependencies and consumers`  | Resolved file references, external specifiers, unresolved references; never imply a complete call graph  |
| `## Feature flows`               | Supported cross-file sequences or an explicit statement that none were established                       |
| `## Tests`                       | Relevant inspected test files; do not claim they were executed or passed                                 |
| `## Child folders`               | Links to every included direct child summary                                                             |
| `## Coverage and limitations`    | Disposition counts, skipped boundaries, unsupported/unreadable inputs, and uncertainty                   |
| `## Evidence`                    | Evidence IDs, source links, byte hashes, line ranges, optional symbols, and basis                        |

Empty sections MUST say `None observed` or `Not established`, with the relevant
limit. Tests cannot be inferred from filenames alone: a filename can identify a
candidate, while inspected assertions establish described coverage. Parents link
to child detail rather than repeating it, and cannot turn partial child analysis
into an unqualified complete project claim.

### Example narrative

This is an illustrative excerpt for a hypothetical repository, not a claim about
SHContext's own code. The full generated file still requires all sections above.

```markdown
# Context: src/auth

## Purpose

Checks submitted passwords and returns a session token on success. [E1]

## Files and responsibilities

| File      | Mode           | Responsibility                               |
| --------- | -------------- | -------------------------------------------- |
| login.ts  | structural     | Exposes login(); calls checkPassword(). [E1] |
| legacy.py | inventory-only | Unsupported language; behavior not analyzed. |

## Tests

The rejected-password test inspects a failed login response. [E2]
SHContext inspected this test; it did not execute it.

## Coverage and limitations

Partial: legacy.py is inventoried but not semantically analyzed.
Session behavior outside the inspected code is not established.
```

An evidence record is scoped to the folder summary and has an ID such as `E1`.
It contains `path`, `sha256`, `start_line`, `end_line`, nullable `symbol`, and
`basis` (`source`, `configuration`, or `documentation`). Lines are 1-based and
inclusive, computed from the exact decoded bytes (CRLF is one line ending).
References must point to inspected, readable content, not ignored/inventory-only
files. Every behavioral claim cites evidence; each inference additionally labels
its reasoning. A documentation citation supports what documentation says, not
independent proof of implementation. Evidence IDs in prose MUST resolve.

## Inventory and reports

The same inventory record shape is used by `scan` and persisted build reports:

| Field         | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `path`        | Root-relative file path or directory boundary                              |
| `kind`        | `file` or `directory`                                                      |
| `disposition` | Exactly one value from the next table                                      |
| `reason`      | Stable machine code, e.g. `unsupported_language`                           |
| `mode`        | `structural`, `text`, `configuration`, `inventory-only`, or `none`         |
| `bytes`       | File size when known, otherwise `null`                                     |
| `sha256`      | Raw-byte digest for readable non-sensitive selected text, otherwise `null` |
| `diagnostics` | Sanitized code/message pairs, never source/credential excerpts             |

| Disposition      | Example reasons                                                                                                  | Coverage effect                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `analyzed`       | `supported_source`, `supported_text`, `supported_configuration`                                                  | None                                         |
| `inventory-only` | `unsupported_language`                                                                                           | Partial                                      |
| `ignored`        | `gitignore`, `shcontextignore`, `noise_directory`, `sensitive_path`, `tool_output`, `vcs_metadata`               | None; explicit policy scope                  |
| `skipped`        | `binary`, `non_utf8`, `lockfile`, `source_map`, `generated_code`, `symlink`, `special_file`, `nested_repository` | None; declared exclusions                    |
| `skipped`        | `too_large`, `sensitive_content`                                                                                 | Partial                                      |
| `unreadable`     | `permission_denied`, `read_failed`, `directory_unreadable`                                                       | Partial and unverifiable input               |
| `parse-error`    | `syntax_error`, `parser_failed`                                                                                  | Partial; no behavioral summary for that file |

An enumerated real directory without a boundary diagnostic is `analyzed` with
`reason: directory_enumerated`, `mode: none`, and null size/hash. This means its
entries were listed, not that its descendant code was semantically analyzed.
Never count pruned descendants as discovered entries. Keep separate counts by
kind and disposition; label them as counts of observed entries. A directory
boundary represents an unknown number of descendants.

`report.json` contains `schema_version`, `input_id`, root `coverage`, sorted
`entries`, aggregate `counts`, run-level `diagnostics`, and `policy_exclusions`
containing the fixed reserved roots `context/` and `.shcontext/`. These roots
are not observed entries: their existence/content never changes input identity
or counts. Other pruned boundaries remain observed entries. The scan stdout uses
this shape and computes an identity even for a partial scan; null per-entry
digests never assert that unreadable contents are known. In scan output,
`analyzed` means local syntax/text inspection completed, not that model summaries
were generated. Reported paths themselves can disclose project information: review
the whole output before publishing. No absolute paths, raw snippets, provider
responses, secret matches, timestamps, or credentials belong in this portable
report. Time/cost operational logs, if enabled, belong only in root `.shcontext/`.

## Manifest and ownership

`manifest.json` MUST contain:

The executable version-1 record layouts and example payloads are defined in the
[shared data contract guide](data-contracts.md). Folder summary records also carry
per-kind/disposition subtree counts; the renderer owns that mechanical metadata.

| Field               | Contract                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `schema_version`    | Integer `1`                                                                                                              |
| `generator`         | SHContext version and `generation_id`                                                                                    |
| `generation`        | Effective provider/model ID; parser/resolver, prompt/template, renderer, detector and default-policy version identifiers |
| `selection`         | Effective configuration without credentials and ordered root-relative ignore-control file paths/digests                  |
| `input_id`          | Snapshot digest defined below                                                                                            |
| `coverage`          | Root complete/partial result                                                                                             |
| `provenance`        | Object with nullable `git_head`; informational, excluded from freshness                                                  |
| `files`             | Selected text identities: path, digest or null, disposition, reason and mode                                             |
| `directories`       | Included source directories and their coverage                                                                           |
| `outputs`           | Every owned generated path except the manifest itself, with raw-byte digest                                              |
| `analysis_failures` | One primary limitation per affected path: unsupported language, access/parser failure, oversized or sensitive content    |
| `diagnostics`       | Sanitized run-level code/message records                                                                                 |

The output list includes `context/.shcontext/report.json` and, when present,
`context/.shcontext/cache.json`. The optional version-1 structured cache stores
complete `FolderSummary` records and folder input hashes, validated against exact
rendered Markdown. Old outputs without a cache remain readable; their first update
regenerates to populate it. Cache presence requires complete, matching owned bytes. The manifest does not
hash itself, avoiding a circular digest. Reject unknown schema versions and
unsafe/duplicate paths. A manifest is an ownership/integrity record, not a signed
authenticity guarantee. Verification MUST also derive expected folder/output
sets from current discovery; a fabricated manifest cannot omit source folders
and pass solely by matching its own list. Unexpected files inside `context/`
invalidate ownership and block replacement until moved aside.

Do not hand-edit generated files. An output digest mismatch is `invalid` even
when source is unchanged. Manual notes live outside the owned output. A fresh
checkout with committed output MUST be verifiable without root `.shcontext/`,
an API key, network access, or the original machine's absolute paths.

## Freshness identities

SHA-256 strings are lowercase hexadecimal prefixed by `sha256:`. Hash source
bytes without newline normalization. Use a versioned encoding `identity-v1`:
UTF-8 JSON arrays, no insignificant whitespace, proper JSON string escaping,
decimal integers, and explicit nulls. Sort path-keyed arrays lexicographically by
UTF-8 byte order. Use arrays/tuples with specified field order, not unspecified
object serialization; do not normalize Unicode or lowercase paths.

1. **Policy identity:** hash `["policy-v1", effective-configuration-tuples,
ignore-control-tuples, default-policy-version, detector-version]`. Configuration
   tuples are sorted `[key,value]` pairs with nested objects recursively represented
   as sorted pairs. Ignore-control tuples are sorted `[path,raw-byte-digest]` pairs.
   An absent optional control file is represented by its path and null digest;
   adding/removing one changes policy. Record every discovered nested `.gitignore`
   outside pruned boundaries plus root `.shcontextignore` and
   `shcontext.config.json`. No user-global exclusion inputs exist in v0.1.
2. **Input identity:** hash `["input-v1", policy-id, entry-tuples]`, where each
   sorted entry tuple is `[path,kind,disposition,reason,mode,text-byte-digest]`.
   The digest is null for directories and excluded/non-text content. Sensitive
   content is never persisted as a digest. Unsupported selected text is hashed
   to detect changes even though its content is not semantically summarized.
3. **Generation identity:** hash `["generation-v1", component-tuples]`, sorted
   `[name,version-or-value]` tuples for generator, schema, parser/resolver,
   prompt/template, renderer, detector/default policy, and provider/model.
   Persist effective identifiers, never credentials. A verifier compares the
   installed component/configuration identity without contacting the provider;
   an unversioned model alias cannot guarantee identical future model behavior.

Unknown bytes are represented by null plus their diagnostic disposition; such
an identity records a partial scan but cannot prove unreadable content unchanged.
Binary/excluded file bytes are outside freshness scope; path/type/disposition
changes remain observable. Timestamps, Git HEAD, generated output, and caches
are excluded from source identity. Exclude `bytes` from identity for non-text
entries, whose content does not support any explanation. Reports may retain the
observed size; verify compares semantic inventory fields, not a newly rendered
report's bytes. It still checks the persisted report's ownership digest.

Verification precedence is `invalid`, then known `stale`, then `unknown`, then
`fresh`. First validate schema, output ownership, and internally recorded evidence
references; then compare policy/generation/current discovery. Check evidence
against current source ranges only after its recorded identity matches. A changed
or deleted referenced source is `stale`, not output corruption. An unreadable selection-control
file prevents comparison and yields `unknown`; it is never treated as absent.
Complete and partial coverage remain independent of these four states.

For the selected source to be considered unchanged, changes to ignored
descendants do not matter, but inclusion-policy changes do. A newly tracked file
formerly hidden by `.gitignore` changes the inventory and invalidates context.

## Compatibility and generation stability

Schema version is independent of package version. New required fields, renamed
headings or changed hash semantics require a new schema version. A generator
upgrade changes generation identity and requires a rebuild, not an automatic
rewrite during verify. Render LF newlines, stable headings and sorted inventory
tables. Identical inputs imply identical mechanical identities; repeated LLM
summaries are not guaranteed to be byte-identical or equally accurate.

Optional provenance may change after a rebuild, but provenance changes alone do
not invalidate an existing output. Omit wall-clock timestamps from portable
Markdown and reports to keep reviews focused on source and explanation changes.
