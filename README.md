# SHContext

SHContext is a repository context generator under development. It will create a `context/`
directory that mirrors source folders and explains their responsibilities with
source references and explicit coverage limits.

The current CLI implements `scan <directory>`: deterministic local discovery,
exclusions, content gates, syntax validation and a JSON inventory, with no model
calls or source writes. It also provides typed library APIs, shared contracts,
packaging and development checks. Context generation and installable skills
remain future work; `0.0.0` is not a completed v0.1 release.

## Try the foundation

Use Node.js 22.14+ on the 22 release line or Node.js 24, with npm 10+.

```sh
git clone https://github.com/HarshPopat23/SHContext.git
cd SHContext
npm ci
npm run check
npm run cli -- --help
npm run cli -- scan .
```

`npm ci` builds the project through `prepare`. To make the command available in
your shell after building:

```sh
npm link
shcontext --help
shcontext --version
shcontext scan .
```

Alternatively, `npm pack` creates a local tarball that can be installed with
`npm install --global /path/to/shcontext-0.0.0.tgz`. This package is not published
to npm; registry publication is disabled during development.

## Reusable library

After installing a built local tarball in your project:

```ts
import { getProjectInfo, type ProjectInfo } from 'shcontext';
// Also available from 'shcontext/core'.
const project: ProjectInfo = getProjectInfo();
console.log(project.version);
```

Importing the library does not run the CLI. Shared runtime schemas and inferred
TypeScript types are also available from `shcontext/contracts`; see the
[data contract guide](docs/data-contracts.md).

```ts
import { scanRepository } from 'shcontext/scanner';
const { inventory } = scanRepository('./my-project');
console.log(inventory.coverage);
```

Scan exits `0` for complete coverage, `2` for partial coverage, and `1` for an
operational/configuration failure. [Scanner documentation](docs/scanner.md)
explains policy, configuration, output, exclusions, identity and limitations.
Generation, update and verification remain future work.

## Project documents

- [Product specification](docs/specification.md): scope, inputs, exclusions,
  languages, freshness, and acceptance criteria.
- [Context format](docs/context-format.md): generated files, metadata,
  references, reports, and examples.
- [Architecture](docs/architecture.md): processing stages, module boundaries,
  consistency, and implementation order.
- [Development decisions](docs/development.md): tooling choices and sources.
- [Repository scanner](docs/scanner.md): implemented discovery, CLI/API and limitations.
- [Shared data contracts](docs/data-contracts.md): module handoffs, validation and examples.
- [Contributing](CONTRIBUTING.md): installation, checks and package boundaries.

Released under the [MIT license](LICENSE).
