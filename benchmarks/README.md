# Benchmarks

Reproducible controlled changes, reviewed claim/file-discovery tasks and two
pinned public repositories are implemented. Run `npm run benchmark:quality --
--check` and `npm run benchmark:real -- --check`; the latter requires Git/network
but never executes third-party code. Reports include literal source exploration
and a flat folder summarizer, source references, exact update outcomes, runtime,
request/byte/token reservations and explicit unavailable actual-model usage.
See [methods](../docs/benchmarks.md) and [recorded results](results/README.md).

`npm run benchmark:agents -- --check` compares sequential execution with four
folder workers using a controlled provider and source review. It asserts identical
owned output, coverage and evidence and measures median latency. See
[the report](agent-results.md) and [execution contract](../docs/agents.md).
Live-provider performance/quality is a separate evaluation requiring authorized
credentials; the harness never calls a real model.
