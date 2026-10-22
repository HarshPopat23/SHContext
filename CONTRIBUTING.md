# Contributing to SHContext

SHContext is under development. The CLI exposes scan/build, and the library
provides shared runtime contracts, repository analysis and context generation.
Read the [generation guide](docs/generation.md) for provider and publication limits.
Read the [specification](docs/specification.md), [format](docs/context-format.md)
and [architecture](docs/architecture.md) before adding behavior.

## Development setup

Use Node.js 22.14+ on the 22 release line, or Node.js 24, with npm 10 or newer.
Node 24 is the default in `.nvmrc`. CI checks Node 22 and 24 on Linux and Windows.

```sh
git clone https://github.com/HarshPopat23/SHContext.git
cd SHContext
npm ci
npm run check
npm run cli -- --help
```

`npm ci` installs the committed dependency graph and runs `prepare` to compile
the project. If lifecycle scripts are disabled, run `npm run build` explicitly.
Use `npm install` when deliberately changing dependencies and commit the updated
`package-lock.json`. Do not use a global TypeScript or Prettier installation.

## Commands and checks

| Command                    | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run build`            | Clean `dist/` and emit Node ESM, declarations and source maps                              |
| `npm run typecheck`        | Strict source checking without emission                                                    |
| `npm run format`           | Apply the pinned Prettier version                                                          |
| `npm run format:check`     | Check formatting without writes                                                            |
| `npm test`                 | Build, run CLI/library tests, pack/install with a fresh npm cache and check consumer types |
| `npm run test:integration` | Build and check CLI behavior, installed APIs and consumer declarations                     |
| `npm run check`            | Formatting, type checking and the test suite                                               |
| `npm run cli -- --help`    | Run the compiled CLI without a global installation                                         |

Tests use Node's built-in runner and live at `tests/*.test.mjs`; fixture files are
not executable tests. Keep fixtures small and self-contained, and never include
credentials or downloaded private repositories. `tests/package.test.mjs` requires
`npm test` or `npm run test:integration` so it can reuse npm's executable path. It installs SHContext from a
local tarball into a temporary consumer with a fresh npm cache; registry access
is required to fetch runtime dependencies. Test files run sequentially because
packing runs `prepare`, which rebuilds `dist/`.

Formatting excludes byte-sensitive fixtures and generated artifacts. The existing
design documents are formatted by the same check. Future behavior should add
meaningful observable tests at the corresponding boundary, including failure and
partial-coverage cases. No model/API key is required for checks; provider tests use controlled responses.

## Library and package boundaries

Keep process argument handling in `src/cli/`; importing `shcontext` or
`shcontext/core` must not start the CLI or inspect a user's repository. Use `.js`
extensions in relative TypeScript imports so emitted ESM resolves in Node.
Do not export placeholder scanners/providers. Import shared schemas/types from
`shcontext/contracts`; read the [contract guide](docs/data-contracts.md) before
changing handoff records. Generation and provider entry points are available from
`shcontext/generation` and `shcontext/providers`; provider credentials remain host
configuration, outside analyzed repository files.

`npm pack` builds a tarball through `prepare`. Its allowlist includes compiled
output, corresponding TypeScript sources for source/declaration maps, docs and
license; it excludes tests, fixtures and CI files. Do not commit `dist/`,
`node_modules/`, tarballs or root `.shcontext/` state.

The package is intentionally `private: true` until a release and registry name
are reviewed. Local packing and installation work; registry publication is not
configured. Changes should be submitted in a focused PR with a behavior summary
and validation results. Contributions are provided under the repository's MIT
license.
