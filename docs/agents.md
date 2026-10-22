# Four roles and bounded execution

The four roles are executable stages of the existing local pipeline. They use
one selected provider adapter and shared evidence contracts; they do not create
four autonomous shell agents or require a hosted service.

| Role                 | Implemented responsibility                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coordinator          | Validate execution policy, assign disjoint folder jobs, reserve budgets, cancel/drain workers, assemble validated records and publish through the single existing writer |
| Folder Analyst       | Generate one bounded folder's narrative from inspected direct bodies, child summaries and deterministic graph facts; return records without filesystem writes            |
| Architecture Analyst | Generate the root narrative/project flows after all children finish, using their evidence and repository-wide declared relationships                                     |
| Verifier             | Match every cited range/hash against inspected source; optionally review every narrative claim, rationale, test description and model-authored limitation against source |

```sh
shcontext build .                         # sequential default
shcontext build . --workers 4              # bounded asynchronous folder pool
shcontext update . --workers 4 --retries 1
shcontext build . --workers 4 --review      # extra fallible model review
shcontext build . --max-requests 8 --max-input-tokens 200000
shcontext build . --max-cost-usd 0.25 --input-usd-per-million 2 --output-usd-per-million 8
```

The prices in the last example illustrate user-supplied rates. They are **not**
current prices for any model. Supply the intended provider/model's actual rates
and inspect its own limits. No price is inferred from repository configuration.

Library options extend `BuildOptions` and also apply to `updateRepository`:

```ts
import { buildRepository } from 'shcontext';
const result = await buildRepository('./repo', {
  provider, // host-selected ModelProvider matching repository provider/model IDs
  signal: controller.signal,
  review: true,
  execution: {
    workers: 4,
    maxRetries: 1,
    budget: {
      maxRequests: 24,
      maxInputTokens: 300_000,
      maxOutputTokens: 98_304,
      outputTokensPerRequest: 4_096,
      maxCostUSD: 1,
      inputUSDPerMillion: 2,
      outputUSDPerMillion: 8,
    },
  },
});
console.log(result.execution);
```

`shcontext/agents` exports role descriptions, execution/review types, Coordinator,
its default budget and typed errors. `BuildResult.execution` and CLI JSON include
workers, peak requests, requests/retries, reserved input/output tokens, optional
caller-priced cost, role task records and review findings. These operational
results are not inserted into portable summaries or presented as proof of quality.

## Scheduling, retries and cancellation

Sequential execution (`workers: 1`) is the default. A depth wave contains only
disjoint folder paths; every child wave finishes before its parents. Sibling
jobs run under a pool of 1–8 async workers. Current child records are sorted
before parent synthesis, and IDs/output/cache records are sorted before rendering.
The root Architecture Analyst runs after all folders. File import cycles do not
form scheduling cycles: folder containment determines the waves.

This pool overlaps model I/O on one Node event loop. Local scanning/parsing stays
synchronous; it does not claim CPU parallelism or spawn worker threads. Each
folder still obeys selection, source-size, narrative, provider and coordinator
budgets. Oversized evidence aborts instead of truncating. Folder workers can
only return records through this pipeline; a host-supplied adapter is trusted code,
not an OS-sandboxed capability.

The Verifier runs after generation and before publication. Only the Coordinator
stages/publishes, under the same lock/journal/ownership rules as full builds and
[updates](incremental-updates.md). Extra/edited/linked output blocks replacement.
Workers do not write context files, so concurrent sibling completion cannot
produce conflicting writes. Controlled results are byte-identical across worker
counts; real model prose may vary because model generation is nondeterministic.

`maxRetries` is 0 by default and at most 2. Only settled
`RetryableProviderError` failures retry; the initial OpenAI adapter marks HTTP
429/500/502/503/504 responses this way while discarding error bodies. Delay starts
at `retryDelayMs` (default 100, 0–1,000 ms), doubles, and is capped at 1,000 ms.
Other transport errors, refusals, invalid model review, budget failures and
cancelled/timeout requests are not classified as safe transient retries.
The existing **one local draft repair** remains separate, and every repair or
retry consumes a new reservation. There is no automatic model/endpoint fallback.

`timeoutMs` bounds each locally awaited request (default 60,000; maximum 300,000).
A failure stops further queue dispatch, cancels sibling requests and waits for
locally awaited worker tasks to settle before releasing publication ownership.
External SIGINT/SIGTERM use the same cancellation path in the CLI. Even an adapter
that ignores abort cannot hold the local request promise beyond the timeout;
SHContext cannot guarantee that an already accepted remote operation stops or
that the provider will not bill it. Such reservations are never refunded.

## Spending reservations

| Setting                  |                           Coordinator default |
| ------------------------ | --------------------------------------------: |
| `maxRequests`            |                                            64 |
| `maxInputTokens`         |     1,048,576 conservatively estimated tokens |
| `maxOutputTokens`        | 262,144 reserved output tokens across the run |
| `outputTokensPerRequest` |                                         4,096 |
| `maxCostUSD`             |         Unset; request/token caps still apply |

Reservations happen synchronously before every dispatch, including retries,
repairs and model review. Input estimates include UTF-8 bytes of source/input,
instructions, schema and model metadata plus 2,048 framing units. This is a
conservative estimate, not a tokenizer or billing meter. Native OpenAI run/request
limits remain independent and can stop work earlier. Raising a coordinator cap
does not raise adapter limits.

`maxCostUSD` requires both finite nonnegative `inputUSDPerMillion` and
`outputUSDPerMillion`. Reserve `(estimatedInput * inputRate + outputCeiling *
outputRate) / 1,000,000` per request. The cap applies to those caller-priced
reservations, not actual invoices: rate changes, server accounting, reasoning
charges or a custom adapter violating its contract cannot be audited by this
estimate. The OpenAI adapter honors the lower of its own and the coordinator's
`max_output_tokens`; custom adapters must honor the request ceiling too.

There are no global process/environment credential logs or raw request logs.
Failed attempts keep their reservations. `AgentExecutionError.execution` exposes
safe counters/tasks after failures, and `ReviewError` additionally exposes review
findings with the reviewed claim text and hashed source ranges; CLI errors include
the same safe operational accounting. Do not infer
zero spending from a failed run, and do not treat local cancellation as a refund.
Limits apply per invocation, not across separate invocations or user accounts.

## Source-based review is separate from mechanical verification

The default Verifier matches citations to inspected hashes/ranges. Its report is
`mode: mechanical`, `status: not-reviewed`: it has **not** decided that explanations
accurately describe behavior. `--review` opts into additional provider calls.

Model review receives each exact narrative claim with a stable local claim ID,
its rationale and source evidence, plus deterministic interface/relationship
facts. It also reviews model-authored limitations, so unsupported assertions
cannot evade review by appearing as caveats. Responses must cover every claim
once, use only that claim's supplied evidence IDs, and return `supported`,
`contradicted` or `insufficient` with bounded safe explanations. Missing, repeated,
unsafe or invented findings are rejected; a contradiction/insufficiency aborts
publication and returns review findings. Empty narrative requires no model review.

`no-issues-found` is a fallible model judgment, **not proof of correctness**.
A negative-control test shows a contradictory spacecraft claim being rejected;
another deliberately always-supporting reviewer accepts it, demonstrating this
boundary. Human source review and tests remain separate. Neither model review
nor generated test descriptions execute repository tests.

Ordinary unchanged updates still make zero model calls. Explicit `--review` can
review reused summaries without generating new prose or rewriting context.
Execution/spending settings do not alter source identity or imply a new semantic
cache profile. Component version changes invalidate generation normally. A user
wanting new prose should run `build`; stronger review does not silently repair old
claims or rewrite evidence.

## Measurement and research

Run `npm run benchmark:agents -- --check`; add `--write-report` to refresh the
committed Markdown/JSON reports from the measured result. The harness uses eight independent
source folders, one root, controlled 120 ms provider responses, three measured
runs per mode after warm-up, and alternating sequential/parallel order. It enables
model review in both modes, checks every owned output byte hash for equality,
validates complete coverage and source evidence, and requires median speedup
greater than 1.1 for that declared workload. It records source/coverage/evidence
counts, provider requests and observed peak concurrency rather than assuming a
speedup from worker count. Results are reported in
[the controlled benchmark report](../benchmarks/agent-results.md).

Controlled review responses are authored, so this demonstrates orchestration,
mechanical evidence preservation and latency hiding, not independently measured
live-model quality, cost or rate-limit behavior. The Verifier is serial in this
first implementation; its requests and root synthesis bound the possible speedup.
Dependency-heavy/one-folder repositories may see little benefit. Live provider
performance needs a separately authorized key and representative production runs.

[Node's async-work guidance](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
separates asynchronous I/O from CPU work, motivating a bounded async pool instead
of adding worker-thread machinery for model requests. The existing
[publication](generation.md#ownership-and-recoverable-publication),
[provider](generation.md#provider-limits-and-failure-behavior) and
[contract](data-contracts.md) boundaries remain authoritative. These are roles
inside one coordinator, not independent writers or a model correctness certificate.

Package smoke tests install a tarball into a fresh consumer and check declarations
without installing `@types/node`. Zod's public declarations still require a `URL`
type from TypeScript's standard DOM library or the host's Node declarations;
compilation with only `--lib ES2022` is not supported by the existing contract
schema dependency. Cancellation interfaces themselves remain structural.
