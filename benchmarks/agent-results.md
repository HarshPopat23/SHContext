# Controlled agent execution benchmark

This measures async folder scheduling with an authored provider, not live-model
performance, independent semantic accuracy or real billing. Reproduce and refresh
these reports from a checkout with:

```sh
npm ci
npm run benchmark:agents -- --check --write-report
```

8 independent source folders plus root were generated with
source-based model review enabled in both modes. Every provider response waits
120 ms. After one warm-up per mode,
3 timed runs per mode alternate execution order. Measured
time includes source discovery/analysis, generation, serial review, validation and
owned publication; verification and byte-comparison assertions run outside it.

| Measured property                            | Sequential | Four folder workers |
| -------------------------------------------- | ---------: | ------------------: |
| Median elapsed time                          | 2267.41 ms |          1543.10 ms |
| Peak in-flight requests                      |          1 |                   4 |
| Requests, including model review             |         18 |                  18 |
| Folder summaries                             |          9 |                   9 |
| Citation records across summaries            |         17 |                  17 |
| Owned files, including manifest/report/cache |         12 |                  12 |
| Coverage                                     |   complete |            complete |
| Owned output hashes                          |  Identical |           Identical |

Measured speedup: **1.47×**, saving approximately
**724 ms** per controlled run. The threshold check
independently computes median speedup and requires more than 1.1×; it does not
print a success marker unless coverage, output/evidence equality, request counts,
concurrency and the measured speedup pass assertions.

Environment: Node v24.19.0, linux; reported CPU model
AMD EPYC 9V74 80-Core Processor (the label does not establish available CPU quota). Full precision
measurements and each trial are in [agent-results.json](agent-results.json).

The Coordinator overlaps Folder Analyst requests while keeping parent/root order
and a single writer. The Architecture Analyst/root and Verifier remain serial,
which limits speedup. Request count is unchanged; this is not a spending reduction.
The fixture has independent folders, so its latency benefit does not predict
speedup for a one-folder or deeply nested repository.

All source hashes, line ranges, bundle/ownership schemas and output bytes are
checked by the same pipeline in both modes. Controlled review responses agree,
but that agreement is not proof that a model explains code accurately. Separate
negative controls demonstrate both detection of a contradictory claim and failure
of a deliberately always-supporting reviewer. No network call, live-model quality
evaluation, actual-token accounting or real-price comparison occurred.
