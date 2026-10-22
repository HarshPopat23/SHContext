# Update

`updateRepository` shares the full-build analysis, validation and journaled writer.
It reuses owned structured summaries only when complete folder inputs match.
`cache.ts` defines portable cache version 1; `reuse.ts` hashes semantic inputs and
rebinds evidence labels; `changes.ts` reports file changes and optional move hints.
See [incremental updates](../../docs/incremental-updates.md) for the API, impact
rules, migration, ownership and limits.
