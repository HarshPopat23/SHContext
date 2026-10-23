# Recorded evaluation results

These are scripted-provider/source-navigation controls, not live-model quality or billing measurements. Reproduce with the commands in [the method](../../docs/benchmarks.md).

| Dataset    | Tasks | SHContext success@8 | Literal exploration | Flat folder | Reviewed supported / unsupported / unreviewed file claims |
| ---------- | ----: | ------------------: | ------------------: | ----------: | --------------------------------------------------------- |
| controlled |     5 |                   5 |                   5 |           5 | 5 / 0 / 0                                                 |
| is-number  |     3 |                   3 |                   3 |           2 | 1 / 0 / 11                                                |
| mitt       |     4 |                   4 |                   4 |           3 | 1 / 0 / 10                                                |

Success means required-file coverage, declared relationship-label checks and correct no-match abstention for that task. It is not natural-language answer accuracy. Required-file precision/recall, references and individual misses are in [quality.json](quality.json) and [real.json](real.json).

Controlled updates: **8/8** scenarios matched their exact expected folder set, retained reused prose and ended fresh. Unchanged update calls: **0**; flat baseline: **4**.

The false-claim control remained mechanically fresh but had **1** pre-reviewed unsupported claim. No general false-explanation detection is established.

| Dataset    | SHContext generation ms | Flat generation ms | SHContext scripted requests | Flat scripted requests | Input / output token reservations | Illustrative reserved USD |
| ---------- | ----------------------: | -----------------: | --------------------------: | ---------------------: | --------------------------------- | ------------------------: |
| controlled |                  141.75 |              12.81 |                           6 |                      4 | 53342 / 24576                     |                  0.102494 |
| is-number  |                  190.22 |              32.73 |                           2 |                      2 | 51616 / 8192                      |                  0.068000 |
| mitt       |                  158.07 |              50.54 |                           5 |                      5 | 74711 / 20480                     |                  0.115671 |

Those timings are single observations; order/cache and feature differences preclude a speed ranking. Rates are illustrative caller inputs ($1/input million, $2/output million), not model prices. Actual remote model cost is zero for these scripted runs; actual model tokens are unavailable/not applicable. Live quality, tokens and real-price measurement remain blocked.

The separate controlled worker experiment measured **1.47×** speedup (2259.41 → 1534.87 ms), with identical output hashes, coverage and citations, and equal request counts. See [agent-results.json](../agent-results.json) for every trial and environment.

- is-number: [98e8ff1da1a89f93d1397a24d7413ed15421c139 ](https://github.com/jonschlinkert/is-number/tree/98e8ff1da1a89f93d1397a24d7413ed15421c139), MIT; tracked source remained unchanged and no repository code/tests were executed.
- mitt: [6b41670516ed8e8b738612f60491995470aa63b3 ](https://github.com/developit/mitt/tree/6b41670516ed8e8b738612f60491995470aa63b3), MIT; tracked source remained unchanged and no repository code/tests were executed.

Environment: Node v24.19.0, linux. Generation identities and dataset/source SHA-256 bindings are in the JSON. Results from two tiny projects and a controlled fixture do not establish broad production advantage over ordinary exploration or live folder summaries.
