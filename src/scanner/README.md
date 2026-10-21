# Scanner

Reserved for file discovery, selection rules, source identities and sanitized
diagnostics. No scanning is implemented yet. Follow the eligibility contract in
the [specification](../../docs/specification.md).

The scanner boundary produces `RepositoryInventory` and validates it with
`RepositoryInventorySchema` from `../core/contracts/index.js`. See the
[shared handoff guide](../../docs/data-contracts.md).
