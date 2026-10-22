# SHContext

SHContext is a repository context generator under development. It will create a `context/`
directory that mirrors source folders and explains their responsibilities with
source references and explicit coverage limits.

The CLI implements local `scan <directory>` and `build <directory>` with one
OpenAI provider, incremental `update <directory>`, plus offline `verify <directory>`. Builds collect inspected evidence, summarize folders from leaves
to root, add conservative relationships and publish a mirrored `context/` tree.
The reusable library exposes shared schemas, JS/TS analysis and generation.
Query and installable skills remain
planned; `0.0.0` is not a completed v0.1 release.

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
For local structural analysis:

```ts
import { analyzeRepository } from 'shcontext/analysis';
const report = analyzeRepository('./my-project');
console.log(report.modules, report.edges, report.entry_points);
```

[Code structure documentation](docs/code-structure.md) declares language scope,
resolution rules, configuration inspection and unsupported-language fallback.
Only resolved edges have confirmed file targets under the declared policy.
Generation, incremental updates and offline verification are implemented.

## Generate context

Configure `provider: { "id": "openai", "model": "YOUR_STRUCTURED_OUTPUT_MODEL" }`
in a version-1 `shcontext.config.json`, supply `OPENAI_API_KEY` in your host
environment, and run `shcontext build /path/to/repository`. This sends eligible
source to OpenAI. Review exclusions, citations and generated output before sharing
or committing `context/`. See [generation](docs/generation.md) for the complete
setup, library API, budgets, ownership and current limitations. Tests use
controlled providers; live-model quality evaluation remains pending credentials.

## Update context

Run `shcontext update /path/to/repository` after source changes. It refreshes
affected summaries and parents, including changed evidence/dependencies, and
reuses the rest. An unchanged run makes no model calls and needs no API key.
See [incremental updates](docs/incremental-updates.md) for cache invalidation,
move hints, migration and ownership.

## Verify context offline

Run `shcontext verify /path/to/repository` without credentials. It checks owned
output, metadata, links, evidence and current source identities. `fresh` describes
mechanical integrity and freshness; explanation accuracy requires source review.
See [verification](docs/verification.md) for states, exit codes, review guidance and
interrupted-run handling.

## Project documents

- [Product specification](docs/specification.md): scope, inputs, exclusions,
  languages, freshness, and acceptance criteria.
- [Context format](docs/context-format.md): generated files, metadata,
  references, reports, and examples.
- [Architecture](docs/architecture.md): processing stages, module boundaries,
  consistency, and implementation order.
- [Development decisions](docs/development.md): tooling choices and sources.
- [Code structure and dependencies](docs/code-structure.md): extraction API and conservative graph.
- [Offline verification](docs/verification.md): integrity, freshness, source review and recovery.
- [Context generation](docs/generation.md): build command, provider, evidence and recoverable publication.
- [Repository scanner](docs/scanner.md): implemented discovery, CLI/API and limitations.
- [Shared data contracts](docs/data-contracts.md): module handoffs, validation and examples.
- [Contributing](CONTRIBUTING.md): installation, checks and package boundaries.

Released under the [MIT license](LICENSE).
