# Offline verification and source review

`shcontext verify <directory>` and `verifyRepository` check current context without
an API key, network/model calls, Git writes, output rewrites or recovery. A clone
containing source, configuration and committed `context/` needs no root
`.shcontext/` directory. Use the same declared source selection as the build.

```sh
shcontext build /path/to/repository
shcontext verify /path/to/repository
```

The build uses the configured provider; verification is entirely local. The CLI
prints a version-1 `VerificationResult` JSON record to stdout and a concise
mechanical-only status to stderr. Findings have stable contract codes and safe
messages, without source snippets, credentials or provider responses.

```ts
import { verifyRepository } from 'shcontext/validation';
const result = verifyRepository('/path/to/repository');
// result.state, result.coverage, result.findings
```

The root and `shcontext/core` exports expose the same function. Importing them
does not inspect any repository. `verifyRepository` is synchronous and read-only.

| State             | Meaning                                                                                                   | CLI exit |
| ----------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| `fresh`, complete | Recorded selected inputs and installed generation identities match; owned output validates                | `0`      |
| `fresh`, partial  | Same checks pass, but declared analysis limitations remain, such as unsupported languages or parse errors | `2`      |
| `stale`           | A known source, path, selection or generation component changed                                           | `1`      |
| `unknown`         | Relevant input cannot be compared, including unreadable files/directories or unusable selection controls  | `1`      |
| `invalid`         | Missing/corrupt output, malformed format, broken ownership/evidence or active/incomplete publication      | `1`      |

Coverage describes the persisted context snapshot and remains independent of
freshness. Before a valid snapshot can be established, the result conservatively
uses partial coverage. Complete coverage never means that explanations are proven
correct. Results are observations of a quiescent tree, not signed attestations.

## What ordinary code checks

1. The selected root and output/state paths must remain contained real paths.
   Output metadata and summaries must be regular, single-link files; symbolic
   links, unexpected entries and missing owned outputs invalidate ownership.
2. Strict metadata JSON rejects duplicate keys, comments, trailing commas,
   unsupported versions and unknown fields. Shared runtime schemas check the
   manifest and report. Recorded policy/input and generation identities are
   recomputed, not accepted merely because strings happen to match.
3. The persisted inventory determines its expected folder set, manifest files,
   failures and coverage. Every included folder must have an owned summary.
   Current discovery is independently compared afterward: a fabricated inventory
   that consistently omits a currently eligible directory still cannot be fresh.
4. Markdown is checked against SHContext's emitted version-1 dialect, rather than
   evaluated as arbitrary Markdown/YAML. It requires the exact front matter,
   ordered mandatory sections, direct file inventory, child links and subtree
   counts. Filenames, prose, canonical URI-encoded relative links and evidence
   anchors are checked. Unsafe/external link substitutions and raw markup are
   rejected. Owned bytes must match their manifest hashes.
5. Each citation must identify recorded readable, successfully analyzed source,
   with the matching digest and evidence basis. IDs must resolve, and each direct
   file responsibility or test description must cite that file. Inference needs
   reasoning; test entries retain the inspected-only, not-executed label.
   Evidence uses positive inclusive line spans. Line bounds are checked against
   current source only when its content hash still matches the recorded digest.
6. Installed generator/parser/resolver/prompt/template/renderer/detector/policy
   identifiers and configured provider/model identity are compared offline.
   Readable selected bytes and path/type/disposition changes determine staleness;
   timestamps, Git HEAD and generated/state contents do not. Excluded binary bytes
   and changes inside pruned ignored directories remain outside freshness scope.
7. The verifier rechecks source discovery and output/publication identity at the
   end. A concurrent ordinary change prevents an unqualified fresh result.

The verifier accepts the generated format, not hand-edited Markdown variants.
Renderer v1 puts multiple file claims in one paragraph. The checker validates
all citation groups and escaped text in that paragraph; interpreting the exact
semantic boundary and sufficiency of each explanation is part of source review.
Mechanical checks do not decide whether prose actually follows from a citation.
Output reads are bounded to 32 MiB per artifact and 64 MiB per owned tree, with
at most 100,000 enumerated output entries. These are defensive implementation
ceilings; exceeding them fails instead of silently dropping records.

## Precedence and uncertain inputs

The result precedence is **invalid → known stale → unknown → fresh**. Corrupt
output wins even when source also changed. A changed/deleted source reference is
stale; its historical end line is not compared against different current bytes.
An impossible line range against matching source is invalid.

Losing access to a formerly readable file alone is unknown, not proof of changed
bytes. An unreadable directory masks its unknown descendants and nested ignore
controls; their absence from that scan is not interpreted as deletion. A known
change elsewhere still takes precedence and yields stale. Included unreadable
content in either the recorded or current snapshot prevents fresh even when the
remaining identities agree. Unsupported, skipped-sensitive or invalid source
may instead be fresh + partial under the declared policy, without behavior claims
for those files.

Invalid/unreadable selection controls or unavailable tracking metadata can stop
current comparison and yield unknown. This is not output corruption, and the
verifier never treats an unreadable control as absent. Known installed-component
changes can still make the result stale. Unknown versions/invalid structure in
persisted output are invalid. Findings intentionally stop at decisive ownership
or format failures rather than guessing subsequent freshness.

## Source-based explanation review

Keep these separate checks in reviews and CI:

| Question                                                                        | Evidence and approach                                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Do paths, links, required fields, hashes, coverage and source identities agree? | `shcontext verify`, ordinary code and regression fixtures                                                |
| Does the purpose/responsibility/flow accurately describe behavior?              | Read the cited bodies and relevant assertions; evaluate scope and reasoning                              |
| Does documentation describe an implemented feature?                             | Compare implementation evidence; a documentation citation only supports what documentation says          |
| Were tests run and did behavior work?                                           | A separately recorded execution in an appropriate environment; context generation does not execute tests |

For source review, choose a concrete claimed behavior, follow every cited path,
read the specified lines plus necessary surrounding code, and check actual inputs,
outputs, error handling and import resolution. Check that a claimed multi-file
flow is supported, that unresolved/external imports are not promoted to confirmed
runtime relationships, and that child limitations propagate to parent claims.
Inspect test assertions rather than relying on filenames or test descriptions.
Record unsupported or ambiguous claims as findings requiring correction/rebuild.
Keep manual review notes outside the owned output tree.

A model may assist this source review in a future workflow, with clearly labeled
suggestions, inspected evidence and uncertainty. It is optional and is not called
by this command. Model approval, a matching hash, a valid citation or a fresh
state must never be presented as proof of explanation accuracy. A regression
fixture deliberately writes a false, well-cited explanation and verifies that
it can be mechanically fresh, making this limit observable.

## Staging, source changes and interrupted builds

Builds retain the existing single-writer staging and journal protocol. The writer
now applies the same strict identity, metadata, Markdown, link and coverage checks
to staged and installed output, as well as validating the structured build bundle.
It rereads source identities immediately before swapping. A source change during
generation or the pre-swap recheck fails with `source_changed`, preserves previous
owned output and discards unpublished drafts. This release reports the change;
it does not automatically repeat provider calls. Retry the build on a stable tree.

Any nonempty root `.shcontext/` state makes verify invalid, including a live lock,
journal, interrupted claim, abandoned staging or unknown entry. Verify neither
steals a lock nor cleans state. Allow an active build to finish; then verify again.
For an interrupted writer, the next build recovers journal-owned paths under its
lock: pending publication restores old output, while validated publication finishes
backup cleanup. Unowned/edited bytes or uncertain state block recovery and are
preserved for inspection. The [generation recovery guide](generation.md#ownership-and-recoverable-publication)
explains dead-process locks, pre-journal interruption and manual recovery limits.
Do not delete output or state blindly.

A successful build's empty operational directory is allowed; committed context
also verifies after it is removed. No API credentials are required to verify an
interrupted result or one generated with a different provider/model. To actually
perform build recovery, the existing build preflight still requires its configured
provider credentials. Directory swaps are recoverable, not an atomic multi-file
snapshot or protection against hostile writers, power loss or network-filesystem
locking behavior. Files/journals are flushed; directory entries are not portably
fsynced. Use a quiescent local checkout.

Empty analyzed files now receive explicit inventory limitations, without an
impossible 1–0 evidence span or an invented responsibility. This changes the
generator component from `context-pipeline-v1` to `context-pipeline-v2`; previously
generated valid version-1 Markdown is readable and reported stale, requiring a
rebuild. The persisted schema and Markdown renderer remain version 1.

## Research and verification approach

The existing [format](context-format.md), [specification](specification.md),
[architecture](architecture.md) and shared contracts determine identities,
precedence, containment and coverage. The implementation shares identity encoding
with discovery and output inspection with publication to avoid divergent rules.

[CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/) distinguishes escaping,
entity decoding, links and raw markup; the verifier deliberately recognizes only
SHContext's encoded output dialect. It does not infer safe link targets by merely
searching for a Markdown-looking substring.
[Node 22 filesystem documentation](https://nodejs.org/download/release/latest-jod/docs/api/fs.html)
describes exclusive creation, no-follow checks, flush and rename primitives; these
support the existing application journal rather than replacing it.

Acceptance checks were defined before editing using the requested
[unlazy workflow](https://github.com/Leonxlnx/unlazy). Tests cover fresh/partial/
stale/unknown/invalid results, malformed artifacts with recomputed hashes,
missing eligible folders including a coherently fabricated inventory, offline
clean-clone-style verification, source changes, and interrupted publication phases.
Controlled responses supply test context; no live model is needed to establish
this command's mechanical behavior.
