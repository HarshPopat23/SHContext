# Claude Code terminal: install, build, ask, update

This walkthrough uses the active Claude Code session for analysis. You need
Claude Code access, Git, Node **22.14+ on the 22 line or Node 24**, and npm 10+.
Check `node --version`, `npm --version`, `git --version` and `claude --version`.
Install/sign in to Claude Code using its [official setup guide][setup] if missing.
SHContext's recorded plugin-host check used Claude Code 2.1.308; newer host
behavior may differ. No separate model API key is needed for this workflow.

The shell examples below use macOS/Linux/Git Bash syntax. PowerShell equivalents
for setup follow in step 2. Replace paths with your actual absolute paths.

## 1. Keep the tool and repository separate

Example layout: `/work/SHContext` is the tool, `/work/headlamp` is source, and
`/work/shcontext-sessions` holds private generation sessions. Existing clones are
fine. Otherwise create a work directory, then run:

```sh
cd /work
git clone https://github.com/HarshPopat23/SHContext.git
git clone https://github.com/kubernetes-sigs/headlamp.git
cd /work/SHContext
npm ci
node dist/cli/index.js --help
```

Only install SHContext's dependencies. Headlamp does not need `npm install`, a
build or running tests to be analyzed. `npm ci` builds SHContext through its
prepare script. This alpha is not published as an npm registry install; do not
replace these commands with `npx shcontext`.

## 2. Select the target and create a session parent

In the same terminal that will start Claude:

```sh
export SHCONTEXT_HOME="/work/SHContext"
export SHCONTEXT_REPO="/work/headlamp/frontend/src/lib/router"
mkdir -p /work/shcontext-sessions
node "$SHCONTEXT_HOME/dist/cli/index.js" scan "$SHCONTEXT_REPO"
```

The selected directory is the analysis root, not a filter within the whole
Headlamp repository. It controls output location and available configuration,
ignore rules and dependency targets. Parent configuration is not inherited.
Inspect scan coverage and exclusions before proceeding. Exit 2 means partial
coverage; read the report instead of treating that as complete analysis.

PowerShell setup for an equivalent `C:/work` layout:

```powershell
$env:SHCONTEXT_HOME = 'C:/work/SHContext'
$env:SHCONTEXT_REPO = 'C:/work/headlamp/frontend/src/lib/router'
New-Item -ItemType Directory -Force 'C:/work/shcontext-sessions'
node "$env:SHCONTEXT_HOME/dist/cli/index.js" scan "$env:SHCONTEXT_REPO"
```

When using later terminal examples in PowerShell, replace `$SHCONTEXT_HOME` with
`$env:SHCONTEXT_HOME`, and likewise for other environment variables.

## 3. Load the five skills

For the first session, use the local checkout directly:

```sh
cd "$SHCONTEXT_REPO"
claude --plugin-dir "$SHCONTEXT_HOME"
```

This flag loads this checkout for that session; repeat it when starting another
session. Look for `/shcontext:context-build`, `context-update`, `context-query`,
`context-verify` and `context-benchmark` under the `shcontext` namespace.

For persistent installation, run these commands **inside Claude Code** instead:

```text
/plugin marketplace add /work/SHContext
/plugin install shcontext@shcontext-workflows
```

Use your tool checkout's actual path. A user-scope install affects your host's
plugin settings, not Headlamp source. After installation, follow the reload
instruction or start a fresh session. Check from a shell with
`claude plugin list --json`. The plugin adds instructions, not an installed tool
runtime: retain `SHCONTEXT_HOME` and its built checkout. For GitHub marketplace
installation and version pinning, see [the installation reference](skills.md).
Use either the local session flag or the persistent route to avoid duplicate
plugin versions. These routes follow Anthropic's [plugin creation][create] and
[installation][install] contracts.

## 4. Ask Claude to build the first context

Send this in Claude Code, replacing the three example paths if needed:

```text
/shcontext:context-build
Tool checkout: /work/SHContext
Selected source root: /work/headlamp/frontend/src/lib/router
Session parent: /work/shcontext-sessions

Use this active Claude session to analyze source and author structured drafts.
Create a missing shcontext.config.json with provider id host and model label
claude-code-session; preserve any existing configuration and ask before changing
an existing provider. Use a new session directory outside the selected root.
Run scan, prepare, submit each requested draft sequentially, finalize and verify.
Include source references, coverage and uncertainty. Do not install Headlamp's
dependencies, run its code/tests or commit context. Report the final output path.
```

If a configuration already selects OpenAI, deliberately choose whether to migrate
it before continuing. Preserve its other settings. A missing host configuration
is equivalent to this file in the selected router folder:

```json
{
  "version": 1,
  "provider": { "id": "host", "model": "claude-code-session" }
}
```

Claude reads bounded evidence and writes JSON drafts, children before parents.
SHContext renders Markdown only after validating the drafts and current source.
`prepare` alone is not completion. Expect `finalize` to report `published`, then
`verify` to report `fresh` and the actual coverage. Check:

```sh
node "$SHCONTEXT_HOME/dist/cli/index.js" verify "$SHCONTEXT_REPO"
```

Open `frontend/src/lib/router/context/CONTEXT.md` in Headlamp. Keep the generated
manifest, report and cache. Outside-folder imports and unexecuted tests should be
labeled. Do not interpret the router-only context as whole-project coverage.

## 5. Ask questions with current-source references

```text
/shcontext:context-query
For /work/headlamp/frontend/src/lib/router, where are route URLs created?
Check context freshness, inspect the relevant source, and cite paths and lines.
Explain which parts of authentication enforcement are outside this scope.
Do not regenerate context.
```

The equivalent read-only terminal operation is:

```sh
node "$SHCONTEXT_HOME/dist/cli/index.js" query "Where are route URLs created?" --root "$SHCONTEXT_REPO" --json
```

A stale/missing context result can still contain current-source candidates, but
Claude must label them. No match does not prove the implementation is absent.

## 6. Change source, refresh and verify

After a normal source edit, run verify again. A controlled input change should
produce stale with exit 1; do not chain the expected stale check to the update
with `&&`, because that would prevent the update from running.

```text
/shcontext:context-update
Refresh existing context for /work/headlamp/frontend/src/lib/router using
/work/SHContext and a new session under /work/shcontext-sessions.
Use this Claude session, preserve the configured host provenance, regenerate
only affected summaries and report regenerated/reused folders. Finalize and
verify. Do not commit anything.
```

Then use `/shcontext:context-verify` for the same root. Repeating update without
source/configuration/generator changes should require zero new host drafts.
The optional benchmark skill exercises controlled evaluations in the complete
tool checkout; it is not a prerequisite for using your context.

## 7. Recover or update the installation

If a session is interrupted, use the same root, session path and mode to resume
`prepare`; see [the protocol](host-generation.md). If source/config/output changed
mid-session, preserve the old session/output and start a new session. Never edit
session IDs, generated Markdown, locks or journals to force verification through.
Finalize/verify exit 0 means complete/fresh, 2 means partial, and 1 means failure
or non-fresh verification. A mechanically fresh result does not prove prose true.

If skills are missing, check the plugin path/namespace and reload. If the CLI is
missing, run `npm ci` in the trusted SHContext checkout, not the plugin cache.
To upgrade a reviewed checkout, update tool and plugin together, reinstall or
refresh the marketplace, and start a new host session. Generation-version changes
can invalidate the context cache. Do not rely on absolute paths from another
machine. For teams, document a reviewed commit and local paths rather than
committing a developer's `SHCONTEXT_HOME`.

[setup]: https://code.claude.com/docs/en/setup
[create]: https://code.claude.com/docs/en/plugins/create
[install]: https://code.claude.com/docs/en/plugins/install
