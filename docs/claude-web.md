# SHContext in Claude web chat (experimental)

Use the separate **web skill ZIPs** with uploaded source archives. The existing
Claude Code plugin and CLI remain available; they have a separate installation.
No separate OpenAI or Anthropic API key is needed: Claude authors summaries in
the active chat, consuming the account's normal usage allowance. Unattended
CLI/CI generation may still use the optional OpenAI adapter.

**Acceptance status:** packaging and the local archive workflow are tested;
actual Claude web installation/execution is not yet certified. The available
browser reaches Claude's sign-in screen. See [web acceptance](claude-web-acceptance.md).

## Get and install the ZIPs

A maintainer builds them from a prepared source checkout:

```sh
npm ci
npm run package:web -- /absolute/new/shcontext-web-distribution
```

Build prerequisites: Git, Node 22.14+ (22.x) or Node 24, npm 10+, Python 3.9+.
On Windows the packager uses `python`; elsewhere `python3`. Output must be a new
directory outside the checkout. Add `--require-clean` for review/release artifacts.
CI's **Claude web skill ZIPs** job uploads `shcontext-web-skills`, containing four
ZIPs, `SHA256SUMS` and `web-distribution.json`. Extract the outer GitHub artifact
wrapper and upload the individual skill ZIPs inside. No npm/marketplace publication
is implied.

| Upload ZIP               | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `context-web-build.zip`  | First generation from source                                |
| `context-web-update.zip` | Incremental regeneration using source plus previous context |
| `context-web-verify.zip` | Read-only validity and freshness checks                     |
| `context-web-query.zip`  | Read-only repository questions and source retrieval         |

Enable **Code execution and file creation** in Claude's capabilities settings.
Go to **Customize → Skills → + → Create skill → Upload a skill**, upload each
desired ZIP and enable it. Team/Enterprise policies may require administrator
enablement. Follow [Claude's current installation guide][use-skills] if labels
change. Each ZIP has one matching skill-name directory containing `SKILL.md`,
instructions and resources, following [the custom-skill format][create-skills].
Do not upload the source `skills-web/` folder, an npm tarball, the whole repository
ZIP or the Claude Code plugin as a web skill.

Consumer requirements: code execution, Python 3.9+ and **already available Node
22.14+ (22.x) or 24.x**. Each skill independently includes compiled SHContext,
locked production JavaScript dependencies and their licenses. No npm, Git,
repository build, model key or network access is required to run it. A Node binary
is not bundled. `resources/web.py preflight` checks versions and imports the
bundled modules; failures do not trigger installation. Other Node release lines
are rejected until tested. Anthropic does not guarantee these exact runtime
versions in every web session. Web network access varies by settings, so a GitHub
URL alone is not source access [as documented][skills-overview].

## Headlamp example

Attach a source ZIP with `frontend/src/lib/router` present. GitHub's **Code →
Download ZIP** can work within the bounds below. For a smaller trial, someone
with a Headlamp checkout can create a source-only archive without `.git`,
dependencies or build outputs:

```sh
git -C /path/to/headlamp archive --format=zip --prefix=headlamp-source/ --output=/absolute/headlamp-router.zip HEAD frontend/src/lib/router LICENSE
```

After enabling `context-web-build`, attach that ZIP and send:

```text
Use context-web-build on the attached Headlamp source ZIP.
Generate context for frontend/src/lib/router. Inspect the archive layout first.
Analyze the prepared evidence yourself, submit each structured draft, finalize
and verify it, then return the downloadable context ZIP. State coverage,
uncertainty and dependencies outside this scope.
Do not request an OpenAI key or install the repository's dependencies.
```

The selected folder becomes the analysis root. `context/CONTEXT.md` describes it;
descendants are mirrored below `context/`. To resolve Markdown source links
locally, extract `context/` beside that selected source root, producing
`headlamp/frontend/src/lib/router/context/`. Outside imports remain unresolved or
external where evidence cannot establish a target. Choose wider source/scope for
wider architecture questions; a narrow archive cannot establish complete Headlamp
routing/authentication behavior.

Save the downloaded output ZIP. It contains `context/` with
`.shcontext/manifest.json`, `report.json`, `cache.json`, plus root
`web-context.json` recording scope/provenance. It contains generated explanations
and evidence, which may be confidential for private repositories. It contains no
source files, drafts, API keys or private chat/session state. Export is a separate
step after fresh verification; the ZIP is not a source backup.

## Update or ask questions in another chat

Attach **both** the updated source ZIP and the previous exported context ZIP.
Keep the same selected subfolder; archive wrapper names may change.

```text
Use context-web-update. I attached updated Headlamp source and the previous
SHContext context ZIP. Update context for frontend/src/lib/router, reuse valid
unchanged summaries, author the changed drafts yourself, then finalize,
verify and return a new downloadable context ZIP.
```

The previous output's ownership, artifact hashes, schemas, coverage and structured
cache are validated before use. Source/configuration/component changes invalidate
affected summaries. Old context can be valid but stale against updated source.
An unchanged update requests zero drafts. Reuse does not depend on an earlier
chat's filesystem. A changed selected subfolder requires a new build.

For read-only verification, attach both ZIPs and ask “Use context-web-verify to
check freshness and coverage; do not regenerate.” For questions ask “Use
context-web-query: where is route creation handled? Inspect current source,
give references and flag stale context.” Retrieval uses paths, symbols, text and
bounded dependency traversal, with no silent regeneration. Structural validation,
matching hashes and model review do not prove explanation accuracy.

## Bounds and failures

| ZIP transport bound        | Limit                                            |
| -------------------------- | ------------------------------------------------ |
| Compressed / expanded size | 64 MiB / 128 MiB                                 |
| Single file / entry count  | 16 MiB / 20,000 (including implicit directories) |
| Path depth                 | 64 components                                    |
| Expansion ratio            | 200, above a 1 MiB per-file allowance            |

Limits apply to the **entire ZIP**, including files outside the selected scope.
Provide a smaller source-only archive when rejected. The helper accepts stored or
deflated ZIPs and rejects encrypted/special/link entries, unsafe paths, duplicate
or case/Unicode-colliding names, Git metadata, prefix collisions and corruption.
It never executes uploaded code or installs project dependencies. New private
workspaces are exposed only after validation; existing workspaces/exports are not
overwritten. Selected-root `context/` or operational `.shcontext/` in source is
rejected: supply previous output separately. Invalid previous output fails closed.

Existing scanner exclusions/limits and JS/TS support still apply; unsupported
languages are inventory-only and partial coverage is disclosed. Selection does
not inherit parent source, configuration or ignore rules. The extracted copy gets
deterministic configuration with provider `host`, model label
`claude-web-session`, and other fields retained. This is host-declared provenance,
not an authenticated model ID. Configuration bytes/component versions remain
part of freshness/cache invalidation. Uploaded ZIP bytes are unchanged.

Generation is sequential: at most 64 drafts, 512 KiB/request, 64 KiB/submission,
8 MiB/session. Narrow large scopes instead of silently omitting work. Source,
config or output changes invalidate an active session. Finalize retains shared
staging, locks, ownership validation, source rechecks and publication recovery.
Resume only with the same private workspace/session. An execution reset loses
unpublished drafts; exported context is the portable update artifact.

Operations return JSON. Exit 0 means success (prepare/submit may still be pending),
2 means fresh/published partial coverage or query with no match, and 1 means
failure or stale/unknown/invalid verification/query context. Export rejects stale
context and archives exceeding reimport limits. Runtime/account/policy failures
are reported as blocked, never as generated context. See the
[complete packaged command/protocol guide](../skills-web/shared/workflow.md).

Run `npm run check` and `python3 tests/web/test_archives.py` for local validation.
Distribution tests install each ZIP outside the checkout, remove npm/Git from
consumer PATH, use no model keys, test a network-denial positive control and
exercise build/update/reimport/query and failure states. These do not replace
[actual Claude web acceptance](claude-web-acceptance.md).

[use-skills]: https://support.claude.com/en/articles/12512180-use-skills-in-claude
[create-skills]: https://support.claude.com/en/articles/12512198-how-to-create-custom-skills
[skills-overview]: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
