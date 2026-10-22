# Querying repository context

```sh
shcontext query "Where is authentication handled?"
shcontext query "verifySession" --root /path/to/repository --json
shcontext query "invoiceTotal" --depth 0 --limit 5
```

The question-only form selects the current working directory. `--root` selects
an explicit directory, `--limit` accepts 1–20 returned files/summaries (default 8),
and `--depth` accepts 0–3 resolved dependency hops (default 1). Quote questions
containing spaces. Queries are read-only, offline and credential-free; they do
not run repository code, package scripts or models, and never build/update output.

The library exports `queryRepository(root, question, options?)`, `QueryError` and
query result types from `shcontext/query`, `shcontext` and `shcontext/core`.
`--json` prints the structured `QueryResult`; ordinary output prints a source
navigation answer with paths, line ranges, declared symbols, inspected excerpts,
relevant generated summaries and dependency resolution labels.

## Retrieval and answer boundaries

1. Run offline verification, then discover and analyze the current selected tree
   under the same exclusions, content gates and JS/TS parser/resolver policy.
2. Search path segments, extracted symbol names, eligible source text and owned
   generated summary text. Structured summary matches promote only the files
   cited by the matching claims; a folder match does not promote unrelated or
   unsupported inventory entries. Split Unicode words, camel case and punctuation;
   remove common question words. Fixed search terms are data, never regular
   expressions, commands or repository-provided instructions.
3. Rank path matches above symbols, source words and weak summary matches, with
   deterministic UTF-8 path tie-breaking. Exact path queries receive a boost.
   A small declared expansion table relates authentication/auth/login/session and
   authorization/permission/access for retrieval. These are candidate expansions,
   not claims that authentication and authorization are equivalent.
4. Reserve roughly half the result slots for the best lexical seeds and expand
   both incoming and outgoing **resolved file-reference** edges within the depth
   and total file limit. Fill remaining slots with lexical matches. A visited set
   terminates cycles. External, computed, ambiguous, excluded and missing imports
   remain labeled references with no confirmed target; they never create graph
   neighbors. Return at most 64 relevant relationship records and report bounds.
5. Re-read eligible source against its scanned hash. Inspect source on every
   query, including questions primarily answered by summaries. Show at most ten
   lines/1,200 characters per returned source, eight matching symbol records
   (names at most 200 characters), and 1,200 characters per retrieved summary.
   References include raw-byte SHA-256, positive line bounds, source basis and
   a matched symbol when available. Escape terminal control characters in display.
6. Recheck source identity, context ownership and freshness before returning.
   A detected concurrent change aborts the query rather than returning mixed
   source identities. Ordinary concurrent/hostile filesystem limitations from
   [verification](verification.md) still apply.

The answer is a deterministic evidence/navigation report. It can identify
`verifySession` and show its expiration guard and the login route that imports
it; it does not infer a complete runtime authentication policy from a filename.
Generated summaries are labeled navigation aids requiring source review. Static
imports do not establish function calls, runtime order or installed packages.
Markdown/configuration excerpts are documentation/configuration observations.
Unsupported, skipped, empty or unreadable matches have no fabricated behavioral
references; they remain inventory-only or have no source excerpt.

There is no embedding service, vector index, LSP, model-based query synthesis or
persisted search index. Each query currently re-scans/re-parses local input;
startup cost scales with the selected repository. Narrow the root and exclusions
when needed. If representative questions expose lexical/graph retrieval gaps,
evaluate embeddings against the same references before adding them. No evidence
from the small fixture evaluation establishes performance or recall on all repos.

## Freshness and missing context

`QueryResult.context` is the full existing `VerificationResult`. The result's
`input_id` refers to the current scan; cached summary references retain their own
snapshot hashes and an explicit `freshness` field.

| Query status      | Behavior                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `answered`        | Fresh context and matching current-source candidates; explanation accuracy still requires review |
| `no_match`        | Fresh context but no lexical/graph candidates; absence of a feature is not established           |
| `context_missing` | No complete context tree; recommend `build`, while returning safe current-source candidates      |
| `context_stale`   | Source, configuration or component identity changed; recommend inspection/update                 |
| `context_unknown` | Included unreadable input prevents a complete comparison                                         |
| `context_invalid` | Output integrity or operational state is invalid; preserve and inspect it                        |

For stale/unknown context, generated summaries can help retrieval but are returned
separately with their state. The answer does **not** present their prose as current.
Invalid output is not used as a summary index. Current source candidates can still
be useful when context is missing or invalid; they do not make old context fresh.
Legacy owned Markdown remains searchable without its structured cache.

Exit `0` means fresh context, complete coverage and matches. Exit `2` means fresh
partial coverage or a no-match result. Missing/stale/unknown/invalid context and
operational/argument errors exit `1`; `--json` still returns retrieval metadata
when current source can safely be inspected. A question is required, has at most
500 characters, and cannot contain control characters. Role/budget flags belong
to `build`/`update` and are rejected for query.

## Evidence and research

`tests/fixtures/query/questions.json` declares six representative questions:
authentication location, an exact symbol, a direct path, a source-text condition,
a billing symbol and an unknown feature. The five known questions retrieve their
expected files; the unknown question reports no match. Additional tests cover
source hashes/ranges, generated-summary retrieval, incoming/outgoing cyclic
links, unresolved targets, stale/missing/invalid/unknown context, credentials,
exclusions, unsupported languages, symlinks, source races and read-only CLI/API
behavior. This is a controlled fixture evaluation, not a production recall study.

[Git's search documentation](https://git-scm.com/docs/git-grep) demonstrates
literal matching and line-number references. SHContext applies those principles
in process so it can preserve scanner exclusions and support ordinary directories;
it does not shell out to grep or search arbitrary files. The existing
[code-structure contract](code-structure.md) supplies symbols and conservatively
resolved edges. A new TypeScript compiler/LSP dependency was unnecessary: the
implemented parser already provides the required structural records.
