# Incremental updates

> Claude Code users can use [host updates](host-generation.md) without a separate API key. This page also documents the optional provider-driven update operation.

`shcontext update <directory>` reuses validated structured summaries and regenerates
folders whose inputs changed. It works with a Git checkout or an ordinary local
directory, uses the same selection policy as `build`, and never edits source,
stages Git files, or commits. `build` remains an explicit full regeneration.

```sh
shcontext build .
# Edit source, then:
shcontext update .
shcontext verify .
```

The library exposes `updateRepository(root, options?)` from `shcontext`,
`shcontext/core` and `shcontext/update`. Options are the existing `BuildOptions`
(`provider`, `signal`, plus [execution/review controls](agents.md)). `UpdateResult` contains the validated `bundle`,
`output_paths`, `changed`, sorted `regenerated`/`reused` folder paths,
`model_calls`, and `changes`. CLI stdout contains those status fields plus
`schema_version`, `input_id` and `coverage`, without the full bundle.

`regenerated` means a summary was recomputed, including deterministic summaries
without model calls; `model_calls` counts every provider request, including a
repair attempt. Exit status is `0` for complete coverage, `2` for partial coverage,
and `1` for an operational/configuration failure. Coverage does not certify
freshness or explanation accuracy: unreadable input can still make `verify`
report `unknown` after a partial update.

## Change detection and impact

Every run performs local discovery, safe content hashing, syntax analysis and
conservative dependency resolution again. Only narrative generation is cached;
this implementation does not promise faster scanning/parsing or persist raw
source bodies. Current working-tree bytes, including untracked files, are the
source of truth. Timestamps and Git HEAD never replace content checks.

`changes.added`, `modified` and `deleted` describe non-ignored observed files,
comparing path, disposition, reason, mode and available content hashes. Folder
changes are reflected in inventory/summary coverage, counts and child links.
Ignored/pruned files and binary content without a digest cannot provide content
change or move evidence. Their observed paths/dispositions still follow scanner
policy. Moves remain additions/deletions for invalidation; `changes.moves` adds
supplementary explanations:

- A unique deleted/added pair with the same non-null source hash is labeled
  `identical-content`. Duplicate deleted or added contents remain ambiguous.
- Available Git history can supply `git-rename-hint` for other pairs. The previous
  manifest's optional HEAD is compared with current tracked/index/worktree state
  using NUL-delimited `git diff --name-status`, explicit rename detection and
  disabled external diff/text conversion. Only selected added/deleted paths are
  candidates. Rename work is limited to 1,000 paths, less than 32,000 argument
  bytes, 4 MiB output and 10 seconds. Missing/shallow history, Git failure, or
  untracked targets simply leave hash-based additions/deletions.

Neither label proves which filesystem operation occurred. A previous dirty build
need not equal its recorded HEAD, so Git hints never authorize reuse or deletion.
They are optional metadata, not confirmed code dependencies.

A folder input hash covers:

| Input                                                                                               | Why it matters                                                                                             |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Effective configuration and every recorded ignore-control digest                                    | Selection, provider/model and limits affect interpretation; changes invalidate all summaries               |
| Generator, parser, resolver, prompt, template, renderer, detector and default-policy identities     | Changes to the transformation invalidate previous results                                                  |
| Observed subtree entries, dispositions, reasons, hashes and counts                                  | Direct additions/edits/deletions and parent inventories must refresh                                       |
| Complete supplied evidence, direct source bodies, exports, entry points and dependency descriptions | Cited explanations must match current inspected input                                                      |
| Resolved dependency target identities                                                               | A changed target conservatively refreshes its direct consumers, even when the import spelling is unchanged |
| Full current child summaries                                                                        | Relevant changes propagate from leaves to parents before publication                                       |

The input digest includes a `folder-input-v1` domain marker. Sequential evidence
labels are normalized to source paths for comparison. Global `input_id` and
`generation_id` fields inside child summaries are excluded from that comparison;
the generation identity is already an explicit hash input. Otherwise one unrelated
file would force every folder to regenerate. A reused summary retains exact
claim boundaries, prose and uncertainty, while citations are rebound to current
inspected evidence and snapshot IDs. The full bundle is validated again.

Incoming consumer evidence is part of a target folder's supplied input, so changes
to that consumer also refresh the target's description. Resolution changes
(including newly resolved, ambiguous, excluded or missing targets) refresh the
folders whose dependency descriptions changed. Cyclic file imports require no
recursive model traversal: the graph is computed first and folders are processed
bottom-up once. This is bounded static evidence impact, not transitive runtime
behavior analysis or a complete call graph. Alias/external/unresolved limitations
from [code structure](code-structure.md) remain in force.

Maintainers must bump affected component version identifiers when their behavior
changes. A custom adapter with the same provider/model identity, or a remote
provider changing model behavior behind the same name, is not automatically
fingerprinted. Use `build` when an explicit narrative refresh is wanted.

## Structured cache, migration and publication

New builds and updates own `context/.shcontext/cache.json`, with this strict
versioned structure (digest placeholders below are illustrative):

```json
{
  "version": 1,
  "input_id": "sha256:<snapshot>",
  "generation_id": "sha256:<transformation>",
  "folders": [
    {
      "input_hash": "sha256:<folder-input>",
      "summary": "<FolderSummary record>"
    }
  ]
}
```

Actual `summary` values are complete `FolderSummary` objects, ordered by
`source_path`, using the existing schema. They store summaries and evidence,
not source bodies, rejected drafts, credentials or request logs. Cache bytes have
an owned output digest in the manifest. The reader checks strict JSON (including
duplicate keys), schema, complete folder coverage, snapshot/generation IDs, and
requires each cached summary to render to exactly its owned Markdown bytes.
A cache mismatch is invalid output, not permission to overwrite it.

The cache is an optional additional owned artifact in the version-1 portable
format. Previous outputs without it remain mechanically verifiable. Their first
`update` conservatively regenerates once to populate structured records; Markdown
cannot safely reconstruct original claim boundaries. Changed component versions
also require regeneration. A recorded cache that is missing, edited, malformed,
linked, or inconsistent blocks replacement. Preserve affected output and inspect
it; do not delete ownership evidence to force an overwrite. Older SHContext
versions that do not recognize the cache will reject the new output format.

Commit the **whole `context/` tree**, including cache, report and manifest, after
review if using team mode. Another checkout can then reuse summaries without
old root `.shcontext/` state. Keep root `.shcontext/` operational files out of Git.
The cache shares the existing 32 MiB per-artifact and 64 MiB tree read limits;
exceeding them aborts publication without discarding the previous tree.

With matching inputs/components/cache, update makes zero provider calls, does
not require an API key, and leaves context bytes and modification times alone.
It still acquires the publication lock, recovers a valid interrupted journal if
needed, and may create an empty excluded root `.shcontext/`. It is not a read-only
command. Missing context can be initialized like a build. Provider configuration
is required; credentials are acquired only if model generation is actually needed.

On change, render and stage a complete consistent tree. Every summary carries the
full repository `input_id`, so reused folders' metadata and citation labels may
change without a provider call. The existing journaled writer checks old ownership
and current source identity before swapping. Obsolete summaries disappear only
as part of replacing a fully owned tree; unexpected user files, edited summaries,
symlinks or hardlinks block the entire operation. Provider failure, invalid drafts,
cancellation or source changes retain previous context. Recovery follows the
same [publication rules](generation.md#ownership-and-recoverable-publication).

Cache hashes and mechanical verification do not prove explanations accurate.
Review source-based claims separately; reusing a summary also reuses its limits.

## Research and acceptance

[Bazel's action-cache design](https://bazel.googlesource.com/bazel/+/refs/heads/staging/src/main/java/com/google/devtools/build/lib/remote/README.md)
keys results by their complete action inputs. SHContext applies that principle to
folder evidence and child summaries; it does not implement Bazel execution or a
remote cache. [Git's diff documentation](https://git-scm.com/docs/git-diff)
distinguishes similarity-based rename detection, NUL output and external
conversion helpers. This informs bounded, optional rename hints rather than using
Git status as a freshness oracle. These are design choices, not claims that
hashes establish semantic truth.

Acceptance checks were defined before editing through the requested
[unlazy workflow](https://github.com/Leonxlnx/unlazy). `update-cache.test.mjs`,
`update-impact.test.mjs`, `update-safety.test.mjs` and `update-cli.test.mjs`
exercise no-op requests/writes, exact regeneration sets, policy/component
invalidation, citation rebasing, moves/ambiguity, dependency resolution changes,
corruption, source races, ownership and transaction recovery. A positive source
edit verifies that the zero-call oracle detects actual generation. Package tests
exercise the installed update API and declarations without consumer @types/node; standard TypeScript libraries still supply URL for Zod. Controlled providers test orchestration and traceability; they do not
measure independent live-model explanation quality.

A controlled exercise used public
[`jonschlinkert/is-number` at `98e8ff1da1a89f93d1397a24d7413ed15421c139`](https://github.com/jonschlinkert/is-number/tree/98e8ff1da1a89f93d1397a24d7413ed15421c139).
Only a local provider configuration and the explicit changes below were added.
The two-folder baseline required two controlled generation requests. No sample
code, package scripts or tests were executed, and no HTTP/model call occurred.

| Change                       | Requests | Regenerated folders | Reused folders   |
| ---------------------------- | -------: | ------------------- | ---------------- |
| Unchanged                    |        0 | None                | `.`, `benchmark` |
| Add `isolated/note.md`       |        2 | `.`, `isolated`     | `benchmark`      |
| Move it to `notes/note.md`   |        2 | `.`, `notes`        | `benchmark`      |
| Delete `notes/`              |        1 | `.`                 | `benchmark`      |
| Edit `benchmark/fixtures.js` |        2 | `.`, `benchmark`    | None             |
| Unchanged again              |        0 | None                | `.`, `benchmark` |

The move had unique identical-content evidence. All recorded source hashes and
citation line bounds were checked, source identity stayed unchanged during each
operation, and offline verification was `fresh + partial` after every update.
Unsupported metadata files account for partial coverage. The responses were
authored for orchestration/traceability evaluation; this is not a live-model
quality benchmark.

The four-role pipeline also applies to updates. Worker-count changes alone do not
invalidate semantic inputs; controlled-provider output remains identical. Source
consistency is checked for reused records. Ordinary no-op updates still make no
model calls. Explicit `--review` requests additional model review of reused
summaries without rewriting context. The execution report accounts for these
requests separately from `regenerated` folders; `model_calls` includes all provider
attempts, including review, repairs and explicitly enabled transient retries.
