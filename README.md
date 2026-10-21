# SHContext

SHContext is a planned repository context generator. It will create a `context/`
directory that mirrors source folders and explains their responsibilities with
source references and explicit coverage limits.

The repository currently defines the design; a CLI and installable skills are
not implemented yet. Commands in the documents are target interfaces.

- [Product specification](docs/specification.md): scope, inputs, exclusions,
  languages, freshness, and acceptance criteria.
- [Context format](docs/context-format.md): generated files, metadata,
  references, reports, and examples.
- [Architecture](docs/architecture.md): processing stages, module boundaries,
  consistency, and implementation order.
