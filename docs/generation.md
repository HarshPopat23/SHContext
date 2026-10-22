# Building repository context

`shcontext build <directory>` implements the first sequential generation pipeline.
It reads the scanner/analysis snapshot, collects inspected evidence, generates
leaves before parents, adds conservative interface/dependency facts, validates
structured folder records and publishes the mirrored `context/` tree. This is a
development implementation; offline `verify` and [incremental updates](incremental-updates.md) are implemented; query remains planned.

## Configure and run

After `npm ci` and `npm link`, create `shcontext.config.json` in the selected root:

```json
{
  "version": 1,
  "provider": { "id": "openai", "model": "YOUR_STRUCTURED_OUTPUT_MODEL" }
}
```

Choose a model available to your OpenAI account that supports the Responses API
and strict JSON Schema output. Supply `OPENAI_API_KEY` through your host's secret
manager or environment, then run:

```sh
shcontext scan /path/to/repository
shcontext build /path/to/repository
```

The first command is local and read-only. The second authorizes sending eligible
source bodies, paths, child summaries and static facts to
`https://api.openai.com/v1/responses`. Review exclusions first. Repository config
cannot supply keys or endpoints. The CLI does not load `.env` files, use another
model on failure, install dependencies or execute repository code/tests. OpenAI
requests set `store: false`; this is not a claim about all provider retention
policies. Review generated context before sharing or committing it to Git.

The JSON result on stdout names coverage, input identity and owned output paths;
progress or safe diagnostics go to stderr. Exit `0` means complete selected
coverage, `2` means published partial coverage, and `1` means an operational,
configuration, provider, budget, draft or publication failure. Complete coverage
does not certify semantic accuracy. Help requires neither a repository nor a key.
Even a deterministic inventory-only CLI build currently requires provider/model
configuration and a host key, although no provider request is made.

## Reusable API

```ts
import { buildRepository } from 'shcontext/generation';
import { OpenAIProvider } from 'shcontext/providers';

const provider = new OpenAIProvider({
  model: 'YOUR_STRUCTURED_OUTPUT_MODEL',
  apiKey: hostSuppliedKey,
});
const result = await buildRepository('/path/to/repository', { provider });
// result.bundle: validated inventory, analyses, edges, folder records, manifest
// result.output_paths: published root-relative paths
```

The adapter identity must exactly match repository configuration. The root and
`shcontext/core` exports also expose `buildRepository`. `BuildOptions.signal`
accepts an AbortSignal-compatible structural interface. The CLI maps SIGINT and
SIGTERM to cancellation, checks cancellation between synchronous local stages,
and aborts in-flight requests. Use a fresh `OpenAIProvider` per build: its run
reservations intentionally accumulate for the lifetime of that instance.
A library caller may inject a `ModelProvider` for controlled tests or future
adapters; it is trusted host code responsible for finite work and cancellation.
The production CLI initially selects only OpenAI.

## Evidence and summary contract

1. Discovery enforces the existing [selection rules](scanner.md). Analysis hashes
   are checked again when collecting eligible bodies. Only successfully analyzed
   structural, documentation and configuration text enters provider requests;
   unsupported, parse-error, skipped and unreadable contents do not.
2. Each inspected file gets a stable evidence ID, raw-byte SHA-256, basis and
   inclusive full-file line span. Bodies are held in memory, never a source cache.
   Full-file spans favor simple traceability in this release; symbol-level citation
   selection is future work.
3. A folder request contains its direct bodies, direct-file dispositions, already
   validated child summaries, and evidence-backed interface/dependency facts.
   Parents reuse original child source citations. Incoming cross-folder consumers
   are represented by their inspected import evidence; their bodies are not
   supplied as direct-file responsibilities. These citations support the import,
   not an inferred caller's runtime behavior.
4. The provider returns JSON drafts containing purpose, direct-file
   responsibilities, feature flows, inspected test descriptions and uncertainty.
   The orchestrator owns inventory, counts, coverage, evidence, metadata and paths.
   Every analyzed direct file must have a supported responsibility. Empty,
   binary-only and unsupported-only subtrees get deterministic summaries without
   a model call. All direct non-ignored files remain in the rendered inventory.
5. Local checks reject unknown fields, omitted/duplicate direct files, invented
   citations, evidence from the wrong file, unlabelled inference, invalid test
   paths and overlong narratives. Exactly one schema/evidence repair is allowed;
   it receives the original evidence and generic repair instructions, never the
   rejected response. Provider/transport failures abort immediately.
6. Export and declared package-entry facts, resolved references, external imports,
   unresolved reasons and incoming consumers are produced from the existing
   structural graph. No model-selected dependency target is accepted in this
   section. A resolved file reference does not imply execution or a call graph.
7. `FolderSummarySchema` and the full `ContractBundleSchema` validate records
   before rendering. The renderer escapes prose and filenames, encodes relative
   link segments and emits every required heading. Unknown sections explicitly say
   `Not established`; tests are marked inspected only, never executed.

Purpose, files, interfaces, dependencies, tests, evidence and uncertainty appear
in every summary. Uncertainty is represented by the existing `limitations` field
and **Coverage and limitations** heading, without changing schema version 1.
Model-authored narrative (including inference rationale and uncertainty) obeys
`folderWordLimit`/`rootWordLimit`. Deterministic inventories, declarations, graph
facts, counts and evidence listings are outside that narrative budget.

Citation and hash validation do not prove prose true. A deliberately false,
well-cited claim is accepted in a regression test to expose that boundary.
Review claimed behavior against bodies, documentation claims against prose, and
inferences against their stated rationale. Prompt-injection instructions remain
untrusted data; the provider has no tools, filesystem access or policy authority.

## Provider limits and failure behavior

The adapter uses native fetch and the Responses API's strict `text.format`
JSON Schema. It rejects refusals, incomplete/malformed responses and redirects.
Successful response bodies are bounded to 1 MiB; error bodies are discarded.
Errors never include raw source, response bodies, HTTP error text or credentials.
No prompt/response logging or additional runtime dependency is introduced.

| Setting                                  |                  Default |
| ---------------------------------------- | -----------------------: |
| Request timeout, including response body |                60,000 ms |
| Declared operating context ceiling       |            81,920 tokens |
| Conservative maximum input per request   |  64,000 estimated tokens |
| Maximum output per request               |             4,096 tokens |
| Maximum input per adapter run            | 256,000 estimated tokens |
| Maximum reserved output per adapter run  |            32,768 tokens |
| Transport attempts per request           |                        1 |
| Local draft repair requests per folder   |                At most 1 |

The estimate is UTF-8 byte length of the entire serialized request plus 1,024
framing tokens. It is deliberately conservative, not a model tokenizer or price
estimate. Reserve the full output ceiling before each request, including repairs,
even if it later fails. Input plus reserved output must fit the configured context
ceiling. These are SHContext operating defaults, not universal model capacities;
select a compatible model and use `OpenAIProvider({ limits: { ... } })` from the
library to set explicit model-appropriate ceilings. Timeout is at most 300,000 ms
and output at most 32,768 tokens. No automatic retry, model switch or endpoint
fallback can consume extra budget.

Large-folder chunking is not implemented in this first pipeline. An oversized
request/run fails with `request_budget`/`run_budget` and an actionable diagnostic,
without truncating files or publishing drafts. Narrow the selected root or
exclusions, or explicitly adjust library limits for a capable model. A later
chunking implementation must preserve claim/evidence associations.

## Ownership and recoverable publication

A single writer stages the complete output under root `.shcontext/`, rechecks
input identity and previous output ownership immediately before swapping, then
moves the old tree to a journal-owned backup and installs the validated new tree.
The journal records UUID-owned names, old/new manifest digests and pending or
validated phase, never bodies or credentials. The installed tree is checked before
backup cleanup. Cleanup retains the backup manifest until last and can resume
after partial deletion. Output includes only mirrored summaries and portable
`context/.shcontext/{manifest,report,cache}.json`. The owned structured cache
preserves exact summaries for [incremental reuse](incremental-updates.md); no raw
source bodies are persisted.

A nonempty context tree must have a valid version-1 manifest and inventory,
matching owned output hashes and exactly the expected files/directories. Extra,
modified, missing, linked or unowned files block replacement before model work.
An empty `context/` can be initialized. No force/overwrite option is implemented.
A manifest is an ownership record, not a signature.

On the next build, a journal left by an interrupted process is recovered under
the lock: pending publication restores the old tree; validated publication finishes
cleanup. An interrupted first installation can be removed only when its remaining
bytes match the recorded new manifest. Unexpected additions or uncertain identity
stop recovery and preserve evidence for manual inspection. A dead build process's
lock may be reclaimed after the host reports its PID absent; PID reuse or an
inaccessible process blocks instead. An exclusive short-lived `claim.lock`
serializes reclamation. If the process dies during that claim, an incomplete
`journal.tmp` is left without a journal, or staging is interrupted before a
journal exists, the next build blocks for manual inspection. Preserve these
paths, establish that no writer is alive, and move uncertain state aside before
retrying; do not blindly delete `.shcontext/` or user output.

This is a same-filesystem recoverable directory swap, not an atomic multi-file
snapshot or a guarantee against hostile filesystem races, power loss or network
filesystem lock semantics. Files/journals are flushed; directory entries are not
fsynced portably. Use a quiescent local checkout. The build never rewrites source
or Git state. Git HEAD is recorded as nullable informational provenance when available;
source and component hashes determine identities. [Offline verification](verification.md) checks freshness separately from publication
ownership and explanation accuracy.

## Research and acceptance evidence

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
  strict schemas constrain shape; refusals and incomplete responses still need
  explicit handling. Local evidence, coverage and semantic review remain necessary.
- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create):
  the adapter supplies `instructions`, `input`, `text.format`, `max_output_tokens`
  and `store: false`, with no tool definitions.
- [Node 22 filesystem API](https://nodejs.org/download/release/latest-jod/docs/api/fs.html):
  exclusive creation, no-follow checked reads, flush and rename are building
  blocks; a journal and single writer provide the application recovery protocol.
- The existing [architecture](architecture.md), [context format](context-format.md)
  and [data contracts](data-contracts.md) govern selection, bottom-up synthesis,
  citation identity and ownership. No provider SDK or multi-agent scheduler is
  needed for this stage.

Acceptance was defined before implementation using the requested
[unlazy workflow](https://github.com/Leonxlnx/unlazy). `generation.test.mjs`,
`provider.test.mjs`, `storage.test.mjs` and `build-cli.test.mjs` exercise the
pipeline, invalid output, failures, budgets and recovery; package tests exercise
installed declarations without consumer Node/DOM types. Core tests use controlled
providers and require no credentials. They are not live-model quality evidence.
A live OpenAI evaluation must separately record repository commit, configured
model, reviewed claims/citations and limits. No OpenAI key was available during
this implementation, so that quality acceptance remains blocked.

A manual controlled-response exercise used public
[`jonschlinkert/is-number` at `98e8ff1da1a89f93d1397a24d7413ed15421c139`](https://github.com/jonschlinkert/is-number/tree/98e8ff1da1a89f93d1397a24d7413ed15421c139),
with only a local SHContext provider configuration added. Two sequential Responses
requests (12,507 and 37,564 conservatively estimated input tokens) produced root
and `benchmark/` summaries, the report and the manifest. The exercise checked
all 14 citation records against raw source hashes, the root test's resolved
`require('./')` target, required sections and unchanged source identity.
`.editorconfig` and `.gitattributes` remained explicitly inventory-only, making
root coverage partial. Purpose, finite-value handling, assertion coverage,
benchmark inventory and documentation limitations were reviewed against the
inspected source. Responses were authored for this exercise and injected at the
transport boundary; no HTTP/model call occurred. This proves pipeline wiring
and traceability on a real tree, not independently generated summary quality.
