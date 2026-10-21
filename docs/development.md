# Foundation decisions

This document records implemented tooling choices. The
[specification](specification.md) still describes the target v0.1 analysis
product, which the current foundation does not implement.

| Choice                                 | Reason and primary reference                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node 22.14+/24 and npm                 | Both Node release lines are LTS at setup time; `.nvmrc` selects 24. [Node releases](https://nodejs.org/en/about/previous-releases)                                                                                                               |
| ESM with TypeScript `NodeNext`         | Compile for Node's module rules without a bundler or development runtime loader. Use explicit `.js` relative imports. [TypeScript compiler guidance](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) |
| Separate CLI and library entry points  | `bin` exposes the executable; `exports` and declarations expose the reusable API without process side effects. [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)                                              |
| Pinned development tools and lockfile  | A fresh checkout uses the reviewed graph with `npm ci`. [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)                                                                                                                                |
| Local Prettier                         | Use one exact formatter version in editors and CI. [Prettier installation](https://prettier.io/docs/install)                                                                                                                                     |
| Native Node test runner                | CLI and package-boundary checks need no additional test framework. [Node test runner](https://nodejs.org/api/test.html)                                                                                                                          |
| `prepare` build and package smoke test | Git/local development compiles, while a packed consumer gets ready-to-run JS and types without development dependencies. [npm scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/)                                                        |
| Linux/Windows and Node 22/24 CI matrix | Check path, executable-shim and runtime boundaries on supported hosts. [GitHub Node CI guide](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)                                                                           |

The runtime currently has no third-party dependencies. Development tooling is
installed locally; no global compiler, provider credentials, scanner, model SDK,
vector store, linter plugin stack or web framework is required. Strict type
checking and formatting are separate checks. This is a project setup, not a
completed v0.1 release.
