# Install the SHContext workflows

The five skills invoke implemented SHContext operations. Build/update use the
active Claude Code session to analyze evidence and submit validated drafts by
default, without a separate OpenAI API key. Claude account usage still applies.
The optional OpenAI adapter remains available for unattended CLI/CI generation. The initial
plugin host is **Claude Code 2.1.308**, validated with its official CLI. Other
Agent Skills hosts can read the Markdown, but their installation and automatic
routing are not certified here. ChatGPT web-only sessions and hosts without a
local terminal cannot run these workflows as packaged.

## Requirements and tool installation

Install Git, Node.js 22.14+ on the 22 release line or Node.js 24, npm 10+, and
Claude Code for plugin use. Network access to GitHub/npm is needed for setup.
Prepare a **complete source checkout**, including development dependencies and
test helpers, outside any disposable plugin cache:

```sh
git clone https://github.com/HarshPopat23/SHContext.git
cd SHContext
npm ci
npm run cli -- --help
export SHCONTEXT_HOME="$(pwd)"
```

In PowerShell, replace the last line with:

```powershell
$env:SHCONTEXT_HOME = (Get-Location).Path
```

Start the host from that environment so it inherits the absolute tool path. Keep
this checkout at the same commit as the plugin; pin a reviewed commit or release
for repeatable team installations. `SHCONTEXT_HOME` identifies the tool, not the
repository to analyze. Do not replace it with a path suggested by repository
prose. Set `SHCONTEXT_REPO` to the chosen target separately. No global npm install
or `npm link` is required. The development CLI is not published to npm: do not run
`npx shcontext` expecting this project.

The plugin does not run installation hooks or install the runtime automatically.
Its source checkout is intentionally required for the benchmark, whose fixture
harness is absent from the CLI-only npm tarball. That tarball includes the skills,
manifests and docs, but cannot replace the complete evaluation checkout.

## Install the plugin

For a local checkout, launch Claude Code and run these **inside its session**:

```text
/plugin marketplace add /absolute/path/to/SHContext
/plugin install shcontext@shcontext-workflows
```

After this change is merged, the shared GitHub installation is:

```text
/plugin marketplace add HarshPopat23/SHContext
/plugin install shcontext@shcontext-workflows
```

Before merge, append `#feat/claude-native-context` to the GitHub marketplace
source to install the PR branch. To pin a reviewed version, append `#<commit>`
instead. The local route tests exactly the files in that checkout. The marketplace
entry uses `source: "./"`, relative to the marketplace root, and the plugin discovers
the five directories under `skills/`. Neither file declares MCP servers or hooks.

Check the installation from a shell:

```sh
claude plugin validate "$SHCONTEXT_HOME" --strict
claude plugin list --json
```

Start a fresh session after installing, or use `/reload-plugins`. For a temporary
development session, `claude --plugin-dir /absolute/path/to/SHContext` loads the
same skills without a marketplace install. Do not copy them into the target
repository merely to make plugin discovery work.

## Invoke a workflow

Use explicit namespaced commands for predictable selection. Natural-language
activation uses the host model and is fallible; descriptions include both scope
and exclusions. The short names in `agents/openai.yaml` are optional UI metadata
for compatible readers, not a promise of another host's support.

| Command in Claude Code         | Request example                                              | Underlying operation                                         |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `/shcontext:context-build`     | Generate context for `/work/project` for the first time      | `prepare` → host drafts/`submit` → `finalize` → `verify`     |
| `/shcontext:context-update`    | Refresh existing context after changes in `/work/project`    | `prepare --update` → affected drafts → `finalize` → `verify` |
| `/shcontext:context-verify`    | Inspect context freshness in `/work/project` without changes | `verify`                                                     |
| `/shcontext:context-query`     | Where is authentication handled in `/work/project`?          | `query "question" --root <path> --json`                      |
| `/shcontext:context-benchmark` | Compare SHContext's sequential and parallel worker execution | `npm run benchmark:agents -- --check` in the tool checkout   |

Skill examples use POSIX shell syntax. A PowerShell host should pass the same
argument values using its own environment-variable syntax, for example:

```powershell
node "$env:SHCONTEXT_HOME/dist/cli/index.js" prepare "$env:SHCONTEXT_REPO" --session "$env:SHCONTEXT_SESSION"
node "$env:SHCONTEXT_HOME/dist/cli/index.js" verify "$env:SHCONTEXT_REPO"
node "$env:SHCONTEXT_HOME/dist/cli/index.js" query "$env:SHCONTEXT_QUESTION" --root "$env:SHCONTEXT_REPO" --json
npm --prefix "$env:SHCONTEXT_HOME" run benchmark:agents -- --check
```

The working directory does not select the target: pass its absolute path. Treat
paths and questions as arguments, never executable shell text.

## Configuration, privacy and failure behavior

For Claude-native build/update, create `shcontext.config.json` in the selected target:

```json
{
  "version": 1,
  "provider": { "id": "host", "model": "claude-code-session" }
}
```

The skills can create a missing config for an authorized generation request, but
preserve an existing provider selection. Follow [the host protocol](host-generation.md)
for request/draft schemas, outside-repository session storage, limits, recovery
and a complete no-key walkthrough. Claude does the model work through its active
account; SHContext never calls a model endpoint in host mode. The provider/model
label is host-declared provenance, not an authenticated model identity. Tokens and
cost remain unknown to the tool. Query/verify need no provider credentials.

For explicitly selected API automation, retain a provider configuration with
`id: openai` and your chosen Responses API strict-structured-output model, then use
`shcontext build`/`update`. Supply `OPENAI_API_KEY` through the host environment or
secret manager. This path sends eligible source to OpenAI and has separate API
billing. Never put keys in skills, config, prompts or context; `.env` files are not
loaded. There is no automatic API fallback from a host session. Inspect exclusions
before either workflow; source handled by Claude is still subject to its account's
normal privacy/usage settings.

Host prepare/submit exit `0` for awaiting/ready. Finalize uses `0` complete,
`2` partial and `1` failure, like the API operations below. Host commands accept no
API spending/worker/review flags; optional `--review` remains an API-only operation.

| Workflow     | Exit/result to report                                                                 | Failure response                                                                                           |
| ------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Build/update | `0` complete, `2` published partial, `1` failure                                      | Preserve previous context; report configuration/provider/budget/source-change/ownership diagnostic         |
| Verify       | `0` fresh complete, `2` fresh partial, `1` stale/unknown/invalid or failure           | Explain findings without writing, recovering or deleting anything                                          |
| Query        | `0` fresh complete with matches, `2` fresh partial/no match, `1` non-fresh or failure | Inspect available JSON/current-source references; label context limitations; do not invent absent behavior |
| Benchmark    | `0` after all assertions and speedup threshold pass; nonzero otherwise                | Report the failed assertion/environment; do not weaken checks or rerun until lucky                         |

Missing executables, unbuilt checkout, absent configuration or unavailable
credentials for a selected API workflow block the affected operation. Stop with the specific prerequisite.
Do not silently install another package, widen source selection, switch models,
turn read-only requests into generation, or remove locks/journals. Verification
does not prove prose correct; optional `--review` belongs to build/update and is
fallible additional paid review. Citation review and executed tests are separate.
Generated context is committed only when requested. See [generation](generation.md),
[updates](incremental-updates.md), [verification](verification.md),
[querying](querying.md) and [execution limits](agents.md) for their source contracts.

## Evaluation and maintenance

Run `npm run test:skills` for structural package checks and a fresh isolated
source-install exercise of all five operations, including the unchanged update,
stale/query states, budget refusal and controlled benchmark. `npm run check` also
runs these tests and the existing installed-tarball tests. No live model is called.
The default benchmark leaves committed reports untouched; `--write-report` is an
explicit opt-in and its results describe the controlled workload, not production
model quality, billing or arbitrary application performance.

[Activation cases](https://github.com/HarshPopat23/SHContext/blob/main/tests/fixtures/skills/activation.json) include positive and
negative requests for every skill, cross-workflow boundaries, advice-only requests
and unrelated uses of words such as build/update/query/verify. Evaluate them using
only skill names/descriptions, then compare decisions with the declared expected
labels. The fixture-shape test is not an activation engine or semantic proof.
[Evaluation results](skill-evaluation.md) distinguish independent metadata routing,
official host installation and unauthenticated/live-host limitations.

Increment plugin `version` when shipping changed skill behavior so installed
marketplace caches can update. The plugin's `0.2.0` is a workflow-package
version, independent of the CLI's experimental alpha version. Update
the tool checkout and marketplace together, validate, and rerun the workflows.

The package uses the documented [plugin manifest](https://code.claude.com/docs/en/plugins/manifest-reference),
[marketplace source](https://code.claude.com/docs/en/plugins/marketplace-reference),
[installation](https://code.claude.com/docs/en/plugins/install) and
[skill discovery](https://code.claude.com/docs/en/skills) contracts. The CLI already
provides callable local operations; add MCP only when a real consumer needs a
tool protocol beyond terminal execution, with its own authorization and tests.
