# Install, generate, change, update and verify

For **Claude Code with no separate API key**, start with [host generation](host-generation.md). The OpenAI examples below are an optional API workflow; installing the plugin does not require them.

SHContext `0.1.0-alpha.1` is an alpha release candidate. This PR prepares the
package and release workflow; it does not publish to npm or claim that a public
GitHub release already exists. The source route works before publication. Live
model quality and actual usage/cost remain pending authorized evaluation.

## Install from source now

Require Git, Node.js 22.14+ on the 22 line or Node.js 24, and npm 10+:

```sh
git clone https://github.com/HarshPopat23/SHContext.git
cd SHContext
npm ci
node dist/cli/index.js --help
```

For this PR preview, run `git switch feat/benchmarks-ci-release` before `npm ci`.
After a public alpha is released, use `git checkout v0.1.0-alpha.1` to pin it.
Set `SHCONTEXT_HOME` to this checkout's absolute path; in POSIX shells use
`export SHCONTEXT_HOME="$(pwd)"`. In PowerShell use
`$env:SHCONTEXT_HOME = (Get-Location).Path` and replace `$SHCONTEXT_HOME` in the
following examples with `$env:SHCONTEXT_HOME`.

## Try the complete offline walkthrough

Choose a **new**, disposable directory. This command creates a tiny TypeScript
project, generates context, edits its greeting, confirms staleness, updates,
verifies freshness, and checks that an unchanged update makes zero calls:

```sh
node examples/offline-demo.mjs /absolute/path/to/new-demo
```

It uses a clearly authored adapter and makes no API calls. Its summary is a
workflow demonstration, not a model-quality result. The command refuses an
existing directory. The same example ships in the installed tarball.

## Generate context for your repository

Set `SHCONTEXT_REPO` to the selected repository's absolute path. Create
`shcontext.config.json` there:

```json
{
  "version": 1,
  "provider": { "id": "openai", "model": "YOUR_STRUCTURED_OUTPUT_MODEL" }
}
```

Choose a model available to your OpenAI account supporting Responses API strict
JSON Schema output. Supply `OPENAI_API_KEY` through your host secret manager or
environment. Never put it in this file, prompts or generated context. The CLI
does not load `.env` files. Inspect Git/SHContext exclusions before generation:

```sh
node "$SHCONTEXT_HOME/dist/cli/index.js" scan "$SHCONTEXT_REPO"
node "$SHCONTEXT_HOME/dist/cli/index.js" build "$SHCONTEXT_REPO"
node "$SHCONTEXT_HOME/dist/cli/index.js" verify "$SHCONTEXT_REPO"
```

Build sends eligible source to the configured OpenAI provider. Start with the
sequential default. Optional `--workers 4` overlaps independent folder requests;
`--max-requests` and the [other spending reservations](agents.md) bound work.
`--review` adds fallible, paid source-based model review; verification itself is
offline. A provider/configuration/budget/source-change error is a failure, not
an empty successful build. Preserve output and diagnose it instead of deleting
locks/journals, widening selection or switching models to force success.

Read `context/CONTEXT.md` and the mirrored child summaries. Follow source paths,
hashes and line ranges to inspect explanations. Unsupported languages remain
labeled inventory-only; unresolved imports are not confirmed relationships.
Mechanical freshness cannot certify semantic truth or that tests ran.

## Change and refresh

Make a normal code edit in the selected repository using your editor. Verify
again: a known changed input should be stale, with exit `1`. Then run:

```sh
node "$SHCONTEXT_HOME/dist/cli/index.js" update "$SHCONTEXT_REPO"
node "$SHCONTEXT_HOME/dist/cli/index.js" verify "$SHCONTEXT_REPO"
node "$SHCONTEXT_HOME/dist/cli/index.js" update "$SHCONTEXT_REPO"
node "$SHCONTEXT_HOME/dist/cli/index.js" query "Where is authentication handled?" --root "$SHCONTEXT_REPO" --json
```

The first update reports regenerated/reused folders and model calls. The second
unchanged default update should report `changed: false`, zero calls and require
no API key. Query is read-only and checks freshness while inspecting source;
no match is not proof that a feature is absent.

Build/update exit `0` for complete selected coverage and `2` for published partial
coverage; `1` is failure. Verify exits `0` for fresh complete, `2` for fresh partial,
and `1` for stale/unknown/invalid or failure. Query also uses `2` for fresh no-match.
Inspect stdout JSON and stderr even when an exit is nonzero. A shell using
`set -e` will stop at expected stale/partial results: capture their status explicitly.

Commit reviewed `context/` when the team wants shared context and CI freshness
checks. Do not hand-edit owned summaries. Do not commit credentials or operational
root `.shcontext/` state. Use [the organization CI example](ci.md) to check the
committed output without provider keys or source writes.

## Install a packaged alpha

From a source checkout, create versioned artifacts in a new directory outside it:

```sh
npm run release:pack -- ../shcontext-alpha-artifacts
npm install --prefix ../shcontext-tools --ignore-scripts ../shcontext-alpha-artifacts/shcontext-0.1.0-alpha.1.tgz
node ../shcontext-tools/node_modules/shcontext/dist/cli/index.js --version
```

Verify the tarball's SHA-256 against `SHA256SUMS`; the manifest records source
revision, dirty state, version and size. Local dirty-tree artifacts are labeled
and are not publication candidates. Install requires npm access for dependencies,
but no TypeScript compiler or development dependencies in the consumer.

After public release, download the tarball, `release-manifest.json` and
`SHA256SUMS` from that GitHub release, verify them, and install the local tarball
the same way. Do not use a registry package named `shcontext`: this project keeps
registry publication disabled. The CLI tarball includes skills/plugin/docs and
the CI helper, but evaluation harnesses require the full source checkout.

See [release procedure](release.md), [benchmarks](benchmarks.md) and
[skill installation](skills.md) for their respective workflows and limits.
