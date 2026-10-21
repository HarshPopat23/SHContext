# SHContext

SHContext is a repository context generator under development. It will create a `context/`
directory that mirrors source folders and explains their responsibilities with
source references and explicit coverage limits.

The TypeScript foundation currently provides CLI help/version, typed library
entry points, packaging and development checks. Repository analysis commands and
installable skills are not implemented yet. Version `0.0.0` identifies this
foundation, not a completed v0.1 release.

## Try the foundation

Use Node.js 22.14+ on the 22 release line or Node.js 24, with npm 10+.

```sh
git clone https://github.com/HarshPopat23/SHContext.git
cd SHContext
npm ci
npm run check
npm run cli -- --help
```

`npm ci` builds the project through `prepare`. To make the command available in
your shell after building:

```sh
npm link
shcontext --help
shcontext --version
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

Importing the library does not run the CLI. The current API exposes package
identity only; repository schemas and pipeline operations come in later steps.

## Project documents

- [Product specification](docs/specification.md): scope, inputs, exclusions,
  languages, freshness, and acceptance criteria.
- [Context format](docs/context-format.md): generated files, metadata,
  references, reports, and examples.
- [Architecture](docs/architecture.md): processing stages, module boundaries,
  consistency, and implementation order.
- [Development decisions](docs/development.md): tooling choices and sources.
- [Contributing](CONTRIBUTING.md): installation, checks and package boundaries.

Released under the [MIT license](LICENSE).
