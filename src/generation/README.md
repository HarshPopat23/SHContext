# Generation

Reserved for evidence selection, folder drafts and Markdown rendering.
No context generation is implemented yet. The renderer will own paths and
metadata; models will return bounded structured drafts. See the
[format contract](../../docs/context-format.md).

Consume `RepositoryInventory`, `FileAnalysis[]` and `DependencyEdge[]`; produce
`FolderSummary[]` using the shared contracts. The pipeline/renderer owns the
`GenerationManifest`. Validate the assembled `ContractBundle` before publication.
See the [shared handoff guide](../../docs/data-contracts.md).
