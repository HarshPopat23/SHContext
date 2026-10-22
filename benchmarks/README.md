# Benchmarks

Reserved for versioned evaluation tasks, reviewed expected answers and reports.
No benchmark score exists yet. Future evaluations should measure evidence
quality, useful file retrieval, update correctness, tokens, latency and cost
against declared baselines. See [architecture](../docs/architecture.md).

`npm run benchmark:agents -- --check` compares sequential execution with four
folder workers using a controlled provider and source review. It asserts identical
owned output, coverage and evidence and measures median latency. See
[the report](agent-results.md) and [execution contract](../docs/agents.md).
Live-provider performance/quality is a separate evaluation requiring authorized
credentials; the harness never calls a real model.
