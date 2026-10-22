# Scanner

`scanRepository(root)` discovers current working-tree files without writes or
model calls and returns a validated `RepositoryInventory`, effective configuration,
control identities, policy identity and component revisions. Public entry point:
`shcontext/scanner` (also `scanRepository` at the package root).

- `index.ts`: bounded traversal, layered selection, inventory and identities.
- `filesystem.ts`: containment checks, bounded read-only descriptors and hashing.
- `git.ts`: read-only index tracking and submodule boundaries.
- `configuration.ts`: strict JSON, controls and duplicate-key rejection.
- `content.ts`: local syntax, generated-code and credential-pattern gates.
- `types.ts`, `errors.ts`: public metadata and sanitized errors.

See [scanner documentation](../../docs/scanner.md), the
[specification](../../docs/specification.md), and the
[shared handoff guide](../../docs/data-contracts.md). The scanner does not produce
symbols, dependency edges, summaries or provider requests.
