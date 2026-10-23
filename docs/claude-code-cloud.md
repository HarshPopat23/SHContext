# Claude Code on the web: use the cloud checkout

This means **claude.ai/code**, where Claude Code works in a cloud environment.
For ordinary Claude chat with attached ZIPs, use [the web chat guide](claude-web.md).
A path on your laptop is not a path inside the cloud environment.

Anthropic's [cloud guide][cloud] describes repository connection and environment
setup. Its [plugin installation guide][plugins] says cloud sessions do not load
plugins installed on your computer or those enabled only in repository settings.
This guide therefore uses SHContext's explicit host protocol, rather than claiming
that `/plugin install` or uploaded web skills configure a Code cloud session.
An actual SHContext cloud-session acceptance test has not been run.

## 1. Connect the repository

1. Open Claude Code on the web and use the host's onboarding to connect an
   authorized repository, such as a Headlamp checkout/fork you can access.
2. Select the intended branch and cloud environment. Local unpushed edits may
   not be present; inspect the actual checkout before generating context.
3. Confirm that the session has file/terminal access. Follow the organization's
   normal policy for any setup downloads; do not assume unrestricted network.

This does not require attaching the ordinary-chat source ZIP. The cloud checkout
is the source input. Account access and normal Claude usage limits still apply.

## 2. Prepare SHContext in that environment

Ask the agent to report `pwd`, the absolute Headlamp checkout path,
`node --version`, `npm --version` and `git --version`. Require Node 22.14+ on the 22 line
or Node 24, with npm 10+. Do not guess `/work/headlamp` or your laptop's tool path.

Use the cloud environment's documented setup mechanism or permitted terminal
commands to clone a reviewed SHContext revision into a separate tool directory
and run `npm ci` there. GitHub/npm setup access is needed; if unavailable, report
that prerequisite instead of switching to an API or inventing an installed tool.
No Headlamp dependency install is needed. Do not store the tool inside the selected
router folder or a temporary plugin cache. Verify the built CLI with:

```sh
node /absolute/cloud/SHContext/dist/cli/index.js --help
```

Use actual reported paths, not these placeholders. Keep the reviewed tool revision
consistent across build/update sessions, or expect generator invalidation.

## 3. Generate with the active cloud session

Send this prompt after substituting the actual cloud paths:

```text
Use the SHContext host protocol in
/absolute/cloud/SHContext/docs/host-generation.md.
Tool checkout: /absolute/cloud/SHContext
Selected source root: /absolute/cloud/headlamp/frontend/src/lib/router
Private session parent: /absolute/cloud/shcontext-sessions

Create the session parent if missing and select a new child session outside
source. Use provider host and provenance label claude-code-cloud-session.
Preserve existing configuration; report before changing an existing provider.
Run scan, prepare, author each requested structured draft from inspected evidence,
submit sequentially, finalize and verify. Include references, coverage and
uncertainty. Do not install Headlamp dependencies, run source/tests or commit.
```

The model label is declared provenance, not a discovered exact model ID. This
uses the active Claude session; no separate OpenAI generation key is needed.
The command contract and accepted draft schema are the same as
[the local host protocol](host-generation.md). The selected router root receives
`context/CONTEXT.md` and its owned manifest/report/cache.

## 4. Ask, change, update and retain results

Ask the cloud agent to run `query "your question" --root <actual-root> --json`,
check freshness and inspect cited current source. For a standalone check use
`verify <actual-root>`. Neither command should silently regenerate context.
After an edit, request `prepare <actual-root> --session <new-outside-session>
--update`, then agent-authored drafts, submit, finalize and verify. Keep the same
host label and scope. An unchanged update should request zero new drafts.

Cloud files can outlive a command without being durable across environment resets.
Before ending, explicitly choose whether to download a full copy of `context/`
(including cache/manifest/report), or review and save it through your normal Git
branch/PR workflow. This guide does not authorize automatic commits or PRs in the
target repository. Private session state is not generated context to commit.
If the cloud environment expires, re-establish the tool/source paths and recover
only from state that actually remains. Do not claim a finished published result
from conversation history alone.

If runtime/setup access or account policy blocks execution, report the missing
prerequisite. If context is invalid/unowned, preserve it and inspect the error.
For expected stale/partial exits and session recovery, follow
[verification](verification.md) and [host generation](host-generation.md).

[cloud]: https://code.claude.com/docs/en/claude-code-on-the-web
[plugins]: https://code.claude.com/docs/en/plugins/install
