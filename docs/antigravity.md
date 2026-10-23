# Antigravity IDE: generate context for a local repository

Use Antigravity's agent as the author and SHContext's local CLI as the scanner,
validator and publisher. This guide covers two separate local checkouts, such as
Headlamp and SHContext, already opened or accessible in Antigravity.

**Integration status:** SHContext ships a Claude Code plugin and Claude web
skills. It does not currently ship a dedicated Antigravity plugin or certify
Antigravity skill discovery. The supported building blocks here are the existing
host-mode commands. This is an explicit agent workflow, not a claim that the
Claude plugin's slash commands install into Antigravity. The local protocol is
exercised in tests; an actual Antigravity IDE session has not been acceptance-tested.

## 1. Check prerequisites and prepare the tool

You need an Antigravity account/model session with permitted local file and
terminal access, Git, Node 22.14+ on the 22 line or Node 24, and npm 10+.
The host account's normal allowance applies; no separate OpenAI generation key
is needed. Follow your organization's normal source-access settings.

Example folders: `/work/SHContext`, `/work/headlamp`, and a private session parent
`/work/shcontext-sessions`. Use your existing clones, or run in the IDE terminal:

```sh
cd /work
git clone https://github.com/HarshPopat23/SHContext.git
git clone https://github.com/kubernetes-sigs/headlamp.git
cd /work/SHContext
npm ci
node dist/cli/index.js --help
mkdir -p /work/shcontext-sessions
```

Do not install Headlamp's dependencies. In a Windows PowerShell terminal, use
`C:/work/...` paths and create the session parent with
`New-Item -ItemType Directory -Force C:/work/shcontext-sessions`.

## 2. Give the agent the correct paths

Open Headlamp in the IDE and make the SHContext checkout and session parent
accessible through the IDE's permitted workspace/file access. If access is denied,
use a dedicated parent workspace containing these checkouts or grant the required
folder access through the host UI. Do not work around an organization restriction.
Opening two folders does not automatically tell the agent which one to analyze.

Use these roles explicitly in prompts:

| Path                                     | Role                                     |
| ---------------------------------------- | ---------------------------------------- |
| `/work/SHContext`                        | Trusted tool and workflow documentation  |
| `/work/headlamp/frontend/src/lib/router` | Selected source root                     |
| `/work/shcontext-sessions`               | Existing parent for new private sessions |

The target is the router folder, so output belongs inside its `context/` directory.
A GUI-launched agent may not inherit variables exported in an IDE terminal.
Give absolute paths in the prompt; do not assume `SHCONTEXT_HOME` is available.

## 3. Select host mode with truthful provenance

Inspect the target's configuration and exclusions. If there is no
`shcontext.config.json`, create it in the selected router folder:

```json
{
  "version": 1,
  "provider": { "id": "host", "model": "antigravity-session" }
}
```

Keep other existing settings. If a provider already exists, deliberately decide
whether to migrate it rather than overwriting the file. The label identifies the
host workflow; it is not an authenticated model ID. Do not use `claude-code-session`
for analysis actually authored in Antigravity. Changing provider/model labels
invalidates previous generation, so keep the chosen label stable for updates.

Scan from the IDE terminal:

```sh
node "/work/SHContext/dist/cli/index.js" scan "/work/headlamp/frontend/src/lib/router"
```

Inspect coverage and skipped files. Selecting a subfolder does not inherit parent
configuration, ignore rules or source dependencies. Go and other unsupported
languages are inventory-only; choose an appropriate JS/TS scope first.

## 4. Ask the agent to perform the complete build

Paste this into Antigravity's agent chat with your actual paths:

```text
Generate SHContext context for this local repository folder.
Tool checkout: /work/SHContext
Selected source root: /work/headlamp/frontend/src/lib/router
Existing private session parent: /work/shcontext-sessions

Read /work/SHContext/docs/host-generation.md for the implemented host protocol.
You are the active Antigravity author: use provider id host and provenance label
antigravity-session, preserving existing settings. If a different provider is
configured, stop and report the required migration instead of silently replacing it.

Use a new session directory outside the selected source root. Run scan and
prepare. For each awaiting_draft request, read the full request and relevant
source, author a JSON response matching draft_schema, cite supplied evidence IDs,
and submit. Work sequentially from children to parents. Continue until ready,
then finalize and verify. Report output paths, coverage, accepted drafts and
uncertainty. Do not call a model API, run source/tests, install Headlamp
dependencies, edit final Markdown or commit generated output.
```

Do not send only “run shcontext build”: that command selects the optional API
workflow. Do not ask the agent to write final `CONTEXT.md` directly; it would omit
SHContext's validated publication/cache protocol.

The agent should execute commands equivalent to:

```sh
node "/work/SHContext/dist/cli/index.js" prepare "/work/headlamp/frontend/src/lib/router" --session "/work/shcontext-sessions/headlamp-router-1"
```

`headlamp-router-1` must be new; its parent must exist. When status is
`awaiting_draft`, the agent reads the returned `request_file` and writes
`response.json` in that session. It must copy current session/request IDs and
cover every supplied direct source once. Then:

```sh
node "/work/SHContext/dist/cli/index.js" submit "/work/headlamp/frontend/src/lib/router" --session "/work/shcontext-sessions/headlamp-router-1" --draft "/work/shcontext-sessions/headlamp-router-1/response.json"
```

Repeat for each new request. Once status is `ready`:

```sh
node "/work/SHContext/dist/cli/index.js" finalize "/work/headlamp/frontend/src/lib/router" --session "/work/shcontext-sessions/headlamp-router-1"
node "/work/SHContext/dist/cli/index.js" verify "/work/headlamp/frontend/src/lib/router"
```

These commands validate but do not author the summaries: the Antigravity agent
must supply its own evidence-grounded drafts. The empty envelope illustration in
the protocol guide is not a valid finished draft. No parallel workers are required.

## 5. Read and query the result

Open `headlamp/frontend/src/lib/router/context/CONTEXT.md`. Keep the manifest,
report and cache in `context/.shcontext/`; they support future updates. Review
source citations and partial-coverage findings. Mechanical freshness is not proof
that every explanation is accurate or that any tests ran.

Ask the agent:

```text
Use /work/SHContext to query context for
/work/headlamp/frontend/src/lib/router: Where are route URLs created?
Run the local query operation, check freshness, read relevant current source
and cite paths/lines. Label outside-scope or unresolved relationships.
Do not regenerate context or edit files.
```

The underlying read-only command is:

```sh
node "/work/SHContext/dist/cli/index.js" query "Where are route URLs created?" --root "/work/headlamp/frontend/src/lib/router" --json
```

## 6. Refresh after an edit

After editing source, verify should report stale (exit 1 for a controlled change).
Ask the agent to use the same host label and root but a **new** session, for example
`/work/shcontext-sessions/headlamp-router-2`:

```text
Refresh existing SHContext context for /work/headlamp/frontend/src/lib/router.
Use /work/SHContext, provider host/model antigravity-session, and a new session
/work/shcontext-sessions/headlamp-router-2. Follow the host protocol with
prepare --update, author only requested drafts, submit, finalize and verify.
Report affected/regenerated/reused folders. Do not use the API update command,
change unrelated files or commit context.
```

The first command is:

```sh
node "/work/SHContext/dist/cli/index.js" prepare "/work/headlamp/frontend/src/lib/router" --session "/work/shcontext-sessions/headlamp-router-2" --update
```

Submission/finalization use the same steps as the build, with the new session
path. An unchanged update can return `ready` immediately with zero new drafts;
it still needs finalize and verify. Preserve valid cached summaries rather than
rewriting them manually.

## 7. Failures and native skills

If the agent cannot access the tool/target, fix the allowed workspace paths first.
If Node or the built CLI is missing, prepare the trusted tool checkout. If the
host cannot execute commands or author the required JSON, this workflow is blocked;
plain prose summaries are not a validated SHContext result.

Exit 2 at finalization/verification means partial coverage; exit 1 means failure
or non-fresh verification. Inspect diagnostics. Interrupted sessions can resume
with the same root/session/mode when inputs remain unchanged. Source/config/output
changes require a new session. Preserve unknown output, locks and journals; never
delete them just to get a passing result. See [host recovery](host-generation.md).

Google documents workspace skills at `.agents/skills/<name>/SKILL.md` (legacy
`.agent/skills` also exists), with surface-specific global paths. That is the
host's discovery convention, not a declaration that SHContext ships an
Antigravity adapter. This guide deliberately uses explicit paths and the shared
protocol. Do not copy only Claude-specific SKILL.md files and assume their host
labels, slash namespaces or relative resources adapt automatically. See
[Google's skills reference](https://antigravity.google/docs/skills) and
[Google's skill-authoring codelab](https://codelabs.developers.google.com/getting-started-with-antigravity-skills)
if developing a separate host-specific skill later.
