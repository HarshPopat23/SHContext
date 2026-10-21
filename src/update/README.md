# Update

Reserved for incremental invalidation and regeneration after the v0.1 full-build
workflow works. No updater is implemented yet. Changes must account for ancestors
and evidence consumers. See [architecture](../../docs/architecture.md).

The planned updater consumes `GenerationManifest`, the new `RepositoryInventory`
and reference/evidence changes. Use the shared contracts rather than defining
another manifest interface. See the [handoff guide](../../docs/data-contracts.md).
