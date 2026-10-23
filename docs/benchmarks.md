# Evaluation methods and limits

Run from a complete source checkout after `npm ci`:

```sh
npm run test:evaluation
npm run benchmark:quality -- --check
npm run benchmark:real -- --check
npm run benchmark:agents -- --check
```

Quality uses a small authored TypeScript repository plus an unsupported Python
file. Real evaluation clones full public repositories at the exact revisions in
[`real.json`](../benchmarks/datasets/real.json), checks out without line-ending
conversion, and checks every tracked file is unchanged afterward. It never
installs their dependencies or executes their code/tests. Git/network access is
required only for that retrieval. The prepared tool and ordinary tests use their
own pinned lockfile.

Both evaluation commands print structured JSON; `--output <file.json>` writes a
report explicitly. CI puts reports outside the checkout and uploads artifacts.
Committed [results](../benchmarks/results/README.md) record the measured run,
environment, generation identities, source hashes, every task/score/reference,
request/byte/reservation counts and update outcomes. These reports are source
artifacts, not a universal score.

## Measurements

| Requested measure                  | Implemented observation                                                                                                                                                    | Boundary                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported/unsupported explanations | Match direct file claims to author-reviewed text, source SHA-256 and inclusive line spans; report supported, unsupported and unreviewed separately                         | Authored provider controls, not independent live-model accuracy; purpose/flow/general narrative is outside this claim denominator              |
| Implementation-file discovery      | Required-file hits, recall, precision against the declared set, all-required task success and no-match abstention at limit 8                                               | Ground truth is the required answer set, not exhaustive judgments of every useful neighbor                                                     |
| Cross-folder questions             | Required source-file coverage across folders plus declared dependency-label constraints; report observed resolved/unresolved links                                         | Measures navigation answers, not full natural-language behavioral explanation accuracy                                                         |
| Updates                            | Exact refreshed folder set for unchanged/edit/add/move/delete/dependency/config/generator scenarios; verify fresh and preserve reused prose                                | Citation IDs can rebase; unchanged prose does not require frozen numeric IDs                                                                   |
| Runtime                            | Measured generation/query/update milliseconds per method; separate worker medians                                                                                          | Quality/real timings are single observations, without a statistical speed claim                                                                |
| Tokens/cost                        | Input/response UTF-8 bytes, conservative reserved input/output tokens, caller-priced reserved cost at illustrative rates; actual model tokens unavailable in scripted mode | Actual remote cost is zero because no model is called, not because production generation is free; reservations are not token usage or invoices |
| Sequential/parallel                | Existing warmed alternating 3-trial median benchmark, exact output/coverage/evidence equality, equal request count and observed peak concurrency                           | Controlled 120 ms response latency, not production model throughput                                                                            |

The reviewed claims are limited and inspectable: prefix/expiry/delegation/summing
in the fixture, finite-number/string acceptance in `is-number`, and handler order
in `mitt`. The remaining real-repository file claims are explicitly **unreviewed**.
The flat and hierarchical controls use the same authored direct-file claims;
perfect agreement on those claims cannot establish an advantage in explanation
quality. Missing/changed source hashes or ranges prevent a reviewed label.

A deliberately false, well-cited claim says the fixture cryptographically checks
signatures and prevents replay. Mechanical verification remains fresh, while the
pre-reviewed negative-control label rejects it. Another test changes a claim to
unknown text and ensures it stays unreviewed. This is a reviewed-answer matcher,
not a general semantic classifier or proof that arbitrary false claims are caught.
Unsupported-language files receive no fabricated behavioral claims.

## Baselines

**Literal repository exploration** scans eligible current source under the same
exclusions, scores literal path/body words and returns at most eight files. It
shares query tokenization, stop words and declared synonym expansion to control
that variable, but uses no generated summaries, symbols or graph traversal.
This reproducible text-search baseline represents one ordinary exploration
strategy, not an experiment measuring human developers or all search tools.

**Flat folder summarizer** analyzes the same selected source and asks the same
scripted adapter for each direct folder independently. It has no child synthesis,
dependency descriptions, published coverage/freshness verification or incremental
cache; its query searches filename/claim text. Its input sizes/reservations are
recorded. Every update regenerates its direct-folder summaries, including no-op.
The scripted claims omit unreviewed behavior; this can lose lexical matches that
remain in raw source. That is a property of this baseline, not evidence about
every real model's folder summarization.

SHContext query time includes source reinspection and freshness checks. Flat query
time searches already generated in-memory summaries; its generation cost is shown
separately. Source search scans/reads current eligible files. Quality runs build
SHContext before the flat baseline, so filesystem cache/order effects can affect
observed timings. Do not rank speed from those single observations. The separate
worker benchmark uses warm-ups and alternating order for its narrower latency test.

Required-file metrics do not assert that an extra retrieved dependency is useless.
A no-match case measures abstention on that question; it does not prove the
feature absent. Static import resolution labels do not establish runtime calls.

## Live follow-up protocol

Live explanation quality, actual provider-reported input/output/cached/reasoning
tokens and caller-priced usage cost are **blocked in this run** by the lack of an
authorized OpenAI key/model and independent source review. They are not replaced
with fabricated usage or a cost inferred from latency. The OpenAI adapter now
exposes `getUsage()` as a scalar snapshot of reported input/output, cached-input,
cache-write and reasoning-output counts. Incomplete responses retain known usage;
transport/HTTP/malformed usage remains explicitly unreported. Missing input-cache
breakdown makes a total cost estimate unavailable. Reasoning is part of output
and is not added a second time. These counters do not certify an invoice.

The opt-in command requires explicit root, new report path, all four caller rates
in USD per million tokens, and a spending cap:

```text
npm run benchmark:live -- --root <repository> --output <new-outside-report.json> --input-price <rate> --cached-price <rate> --write-price <rate> --output-price <rate> --max-cost <usd> [--workers <1-8>]
```

It records available counts and caller-priced cost after success **or failure**.
It requires a configured model and host key, sends eligible source to OpenAI and
publishes context; CI never runs it. Use a disposable copy of a reviewed repository.
It caps dispatch at eight requests and reserves input using the largest supplied
input-category rate. No current price is assumed. Caller rates must apply to all
reported categories/lifetimes; other fees, different write lifetimes or missing
responses prevent treating this estimate as real billing. Reports exclude raw
source, generated prose and response bodies. A failed report write also fails.

Mock-transport tests cover usage/pricing, incomplete responses, HTTP/transport
failure, malformed/missing metadata and pre-dispatch budget rejection. This does
not establish live results. The implementation follows official
[cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching)
and [reasoning-token reporting](https://developers.openai.com/api/docs/guides/reasoning)
documentation; it does not select a model or prices automatically.

For a live evaluation, predeclare repository revisions, question/claim labels,
model identity, prompt/component versions, prices including cached-token handling,
limits, trials and failures. Run the same tasks and baseline budget, preserve all
results including refusals/partial failures, and independently review every sampled
claim against source without seeing method identity. Report unknown/unsupported
claims separately, count all attempts/repairs/retries, collect provider usage even
when generation fails, and keep source/response bodies out of shared logs. Cost
estimates still need explicit price assumptions and cannot certify invoices.

No result here establishes production usefulness across large, multilingual or
changing repositories. The candidate deliberately starts with small fixtures and
two tiny real projects, with enough source/expected/observed detail to reproduce
or refute each bounded claim before broadening the evaluation.
