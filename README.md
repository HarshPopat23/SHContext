# SHContext

SHContext is a repository context generator under development. It creates a `context/`
directory that mirrors source folders and explains their responsibilities with
source references and explicit coverage limits.

The CLI implements local `scan <directory>`, active-host generation through
`prepare`/`submit`/`finalize`, optional OpenAI API `build`/`update`, and offline
`verify <directory>` and `query`. Builds collect inspected evidence, summarize folders from leaves
to root, add conservative relationships and publish a mirrored `context/` tree.
The reusable library exposes shared schemas, JS/TS analysis, generation and local
context querying. Four execution roles run sequentially by default; bounded folder
concurrency and source-based model review are opt-in.
Five installable skills package these workflows for Claude Code.
Separate experimental [Claude web skills](docs/claude-web.md) accept uploaded
source ZIPs and return downloadable context with no separate model API key.
The current `0.1.0-alpha.1` candidate remains experimental. Start with the
[install/build/change/update/verify guide](docs/quickstart.md), including a complete
offline walkthrough. See [evaluation methods and results](docs/benchmarks.md),
[organization freshness CI](docs/ci.md) and [release preparation](docs/release.md).

## Choose your environment

Start with [the step-by-step usage guides](docs/usage.md):

- [Claude Code terminal](docs/claude-code.md): local installation, first build, questions, changes, updates and recovery.
- [Claude web chat](docs/claude-web.md): four skill uploads, small source ZIPs, downloads and cross-chat updates.
- [Antigravity IDE](docs/antigravity.md): separate tool/source folders and an explicit local host-authoring workflow.
- [Claude Code on the web](docs/claude-code-cloud.md): cloud checkout/setup, distinct from ordinary Claude chat.

## Use uploaded repositories in Claude web

Build the web distribution with `npm run package:web -- /absolute/new/output`
from a prepared checkout, or download the `shcontext-web-skills` CI artifact.
Upload its individual `context-web-*.zip` files through **Customize → Skills**,
enable code execution, and attach a source-only repository ZIP. Ask:
“Use context-web-build to generate context for frontend/src/lib/router from this
Headlamp archive and return a downloadable context ZIP.”
See [installation, runtime requirements and updates](docs/claude-web.md).
The bounded Claude web workflow has [actual account acceptance evidence](docs/claude-web-acceptance.md);
the CLI/plugin installation below is separate.

## Install the workflow plugin

Prepare the source checkout below, set its absolute path as `SHCONTEXT_HOME`, then
run these inside Claude Code:

```text
/plugin marketplace add HarshPopat23/SHContext
/plugin install shcontext@shcontext-workflows
```

Use `/shcontext:context-build`, `/shcontext:context-update`,
`/shcontext:context-verify`, `/shcontext:context-query` or
`/shcontext:context-benchmark`. See the [skills guide](docs/skills.md) for local/PR
installation, required executables, configuration, supported hosts and failures.

## Try the source alpha

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
`npm install --global --ignore-scripts /path/to/shcontext-0.1.0-alpha.1.tgz`. This package is not published
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

## Query context

Run `shcontext query "Where is authentication handled?"` in your repository, or add
`--root /path/to/repository --json` for structured results. It searches paths,
symbols, text and summaries, follows resolved dependencies and inspects source.
Missing or stale context is explicit. Queries need no key and make no writes.
See [querying](docs/querying.md).

## Execution roles

Build/update use Coordinator, Folder Analyst, Architecture Analyst and Verifier
roles with one writer. Use `--workers 4` for a bounded folder pool, `--retries 1`
for explicitly transient failures, and `--review` for extra fallible source-based
model review. Request/token caps and optional caller-priced spending reservations
cover every attempt. See [roles and limits](docs/agents.md) and the
[controlled benchmark](benchmarks/agent-results.md); controlled-provider results
do not establish live-model quality or billing.

## Project documents

- [Product specification](docs/specification.md): scope, inputs, exclusions,
  languages, freshness, and acceptance criteria.
- [Context format](docs/context-format.md): generated files, metadata,
  references, reports, and examples.
- [Architecture](docs/architecture.md): processing stages, module boundaries,
  consistency, and implementation order.
- [Development decisions](docs/development.md): tooling choices and sources.
- [Code structure and dependencies](docs/code-structure.md): extraction API and conservative graph.
- [Context querying](docs/querying.md): local retrieval, source references and freshness states.
- [Execution roles](docs/agents.md): sequential/parallel work, source review and spending limits.
- [Offline verification](docs/verification.md): integrity, freshness, source review and recovery.
- [Context generation](docs/generation.md): build command, provider, evidence and recoverable publication.
- [Repository scanner](docs/scanner.md): implemented discovery, CLI/API and limitations.
- [Shared data contracts](docs/data-contracts.md): module handoffs, validation and examples.
- [Contributing](CONTRIBUTING.md): installation, checks and package boundaries.

Released under the [MIT license](LICENSE).

Claude Code can now generate and refresh context using its active session, without a separate model API key. Start with [Claude-native generation](docs/host-generation.md) and the [five skills](docs/skills.md). The OpenAI CLI adapter remains optional for unattended generation.
