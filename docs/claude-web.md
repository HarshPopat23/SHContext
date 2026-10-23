# SHContext in Claude web chat (experimental)

Use the separate **web skill ZIPs** with uploaded source archives. The existing
Claude Code plugin and CLI remain available; they have a separate installation.
No separate OpenAI or Anthropic API key is needed: Claude authors summaries in
the active chat, consuming the account's normal usage allowance. Unattended
CLI/CI generation may still use the optional OpenAI adapter.

**Acceptance status:** the four skills were installed and exercised in Claude web
on a Free account (Sonnet 5.5 Medium, Node 22.22.0, Python 3.13.17). A pinned
Headlamp build, downloaded-context update in a new chat, zero-draft reuse,
multi-folder invalidation and rejection controls passed. See the detailed
[web acceptance record](claude-web-acceptance.md); runtime availability and
account policies still vary.

## 1. Download the four web skill ZIPs

You do not need Claude Code or a terminal on your computer for the consumer
workflow. In the SHContext GitHub repository:

1. Open **Actions** and select a successful **CI** run for the reviewed revision
   you intend to use. The run must include the **Claude web skill ZIPs** job.
2. In the run's artifacts, download **shcontext-web-skills**. GitHub may require
   sign-in. This is an outer artifact ZIP, not itself a Claude skill.
3. Extract the outer artifact once. It contains four `context-web-*.zip` files,
   `SHA256SUMS` and `web-distribution.json`. Upload the four inner ZIPs as-is;
   **do not extract their contents**. Use a recent distribution containing the
   [tested upload-format fixes](claude-web-acceptance.md), not a whole SHContext
   repository download or the old dependency-tree packages.

If a maintainer supplies the four individual ZIPs directly, start at step 2 below.
No npm/marketplace publication is implied by the CI artifact.

| Upload ZIP               | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `context-web-build.zip`  | First generation from source                                |
| `context-web-update.zip` | Incremental regeneration using source plus previous context |
| `context-web-verify.zip` | Read-only validity and freshness checks                     |
| `context-web-query.zip`  | Read-only repository questions and source retrieval         |

## 2. Install them in the Claude account you will use

Enable **Code execution and file creation** in Claude's capabilities settings.
Go to **Customize → Skills → Add skill → Upload skill**, upload each
desired ZIP and enable it. Team/Enterprise policies may require administrator
enablement. Follow [Claude's current installation guide][use-skills] if labels
change. Each ZIP has one matching skill-name directory containing `SKILL.md`,
instructions and resources, following [the custom-skill format][create-skills].
Do not upload the source `skills-web/` folder, an npm tarball, the whole repository
ZIP or the Claude Code plugin as a web skill.

Start a fresh chat after enabling the skills. If you use a different Claude
account, repeat installation in that account. Installing skills does not upload
Headlamp source and does not require an OpenAI key.

Consumer requirements: code execution, Python 3.9+ and **already available Node
22.14+ (22.x) or 24.x**. Each skill independently includes compiled SHContext,
locked production JavaScript dependencies and their licenses. No npm, Git,
repository build, model key or network access is required to run it. A Node binary
is not bundled. `resources/web.py preflight` checks versions and imports the
bundled modules; failures do not trigger installation. Other Node release lines
are rejected until tested. Anthropic does not guarantee these exact runtime
versions in every web session. Web network access varies by settings, so a GitHub
URL alone is not source access [as documented][skills-overview].

## 3. Prepare and attach a small Headlamp source ZIP

Attach a source ZIP with `frontend/src/lib/router` present. GitHub's **Code →
Download ZIP** can work within the bounds below. For a smaller trial, someone
with a Headlamp checkout can create a source-only archive without `.git`,
dependencies or build outputs:

```sh
git -C /path/to/headlamp archive --format=zip --prefix=headlamp-source/ --output=/absolute/headlamp-router.zip HEAD frontend/src/lib/router LICENSE
```

That `git archive HEAD` command includes **committed files only**. It will not
include uncommitted edits when preparing an update. For the current working copy,
create a small ZIP from your local Headlamp checkout with Python 3 instead:

```sh
cd /path/to/headlamp
python3 - <<'PYTHON'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path.cwd()
source = root / 'frontend/src/lib/router'
output = root.parent / 'headlamp-router-working-copy.zip'
assert source.is_dir() and not source.is_symlink(), 'Run from the Headlamp checkout'
assert not output.exists(), 'Choose a new output filename'
files = []
for path in sorted(source.rglob('*')):
    assert not path.is_symlink(), 'Do not archive symlinks'
    parts = path.relative_to(source).parts
    if any(part in {'context', '.shcontext', '.git', 'node_modules'} for part in parts):
        continue
    if path.is_file():
        files.append(path)
assert files, 'No source files found'
license_file = root / 'LICENSE'
assert not license_file.is_symlink(), 'Do not archive a linked license'
if license_file.is_file():
    files.append(license_file)
with ZipFile(output, 'x', ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, 'headlamp-source/' + path.relative_to(root).as_posix())
print(output)
PYTHON
```

Use a new filename for each snapshot. The working-copy script preserves
`frontend/src/lib/router` beneath the wrapper; the web helper still validates all
transport limits. On Windows use an installed Python 3 interpreter (`python`
where appropriate), or ask your IDE agent to create the equivalent source-only
ZIP with the same paths and exclusions. For a browser-only user, obtain this
small archive from a collaborator/IDE; a full GitHub Download ZIP may be too large.
Do not rename a rejected file to disguise its type.

In a **new Claude chat**, attach the **source ZIP to the message**, not to
Customize → Skills. Seeing it in the attachment list is distinct from installing
a skill.

## 4. Generate, verify and download context

Send this prompt:

```text
Use context-web-build on the attached Headlamp source ZIP.
Inspect the archive layout first and identify its wrapper directory.
Generate context for frontend/src/lib/router.
Analyze the prepared evidence yourself, submit each structured draft, finalize
and verify it, then return the downloadable context ZIP. State coverage,
uncertainty and dependencies outside this scope.
Do not request an OpenAI key or install the repository's dependencies.
```

Claude should load `context-web-build`, check runtime compatibility, validate
and open the archive, then run prepare → Claude-authored drafts → submit →
finalize → verify → export. A statement that it read the source is not enough:
request the actual downloadable archive and final freshness/coverage result.
Stop on an incompatible runtime or rejected input instead of fabricating output.

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

## 5. Ask questions and verify without changing context

Attach the source ZIP and the exported context ZIP, then ask:

```text
Use context-web-query on these two archives for frontend/src/lib/router.
Where are route URLs created? Check freshness, inspect current source and cite
paths and line ranges. Identify dependencies outside this scope.
Do not regenerate context.
```

For a standalone check:

```text
Use context-web-verify on the attached source and context ZIPs for
frontend/src/lib/router. Report freshness, coverage and findings.
Do not regenerate or edit anything.
```

Query results are source/symbol/text retrieval, not guaranteed complete answers.
If context is stale or missing, label that result and any current-source findings.

## 6. Refresh after code changes, including in a new chat

Create a new source snapshot that actually includes your edits (see step 3).
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

Download the new context ZIP and use it as the previous output next time. Keep
the original until verification succeeds. The old and new archive wrappers may
differ, but the selected subfolder must match. Structural validation, matching
hashes and model review do not prove explanation accuracy.

## 7. Troubleshoot uploads and interrupted work

| Symptom                            | Next action                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill ZIP rejected                 | Use the individual packaged ZIP, not the outer artifact or repository ZIP. Current packages have 29 files, portable paths and no nested archives. |
| Source ZIP rejected or too large   | Produce the router-only source ZIP in step 3; selecting a subfolder does not reduce the size of an uploaded whole-repository ZIP.                 |
| Skill does not activate            | Enable it in this account, start a new chat and mention its exact name. Check organization policy if upload is unavailable.                       |
| Claude asks for an OpenAI key      | Explicitly select `context-web-build`/`context-web-update`; the native web workflow must not switch to the API CLI.                               |
| Runtime unavailable                | Report the observed Node/Python version and stop; the package does not supply a Node executable.                                                  |
| Context missing in a new chat      | Attach both source and the complete previous output ZIP, including manifest/cache. Earlier chat files are not guaranteed available.               |
| Usage limit or execution reset     | Keep downloaded output; resume later with source plus previous context. Unpublished drafts may be lost and must not be claimed finalized.         |
| Edited or invalid previous context | Preserve it and inspect the ownership error. Do not hand-edit a manifest to force reuse.                                                          |

### Bounds and failure states

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

The upload contains at most 200 files and no nested archives. Compiled JavaScript
bundles include locked production dependencies; their licenses and version
inventory remain separate resources. No extraction or installation is required.

## Package the web skills yourself (maintainers)

In a prepared SHContext checkout, run:

```sh
npm ci
npm run package:web -- /absolute/new/shcontext-web-distribution
```

Build requirements are Git, Node 22.14+ on the 22 line or Node 24, npm 10+, and Python 3.9+.
Use a new output directory outside the tool checkout; add `--require-clean` for
review/release artifacts. The packager uses `python` on Windows and `python3`
elsewhere. Consumers install the generated ZIPs, not the raw `skills-web/` source
folders. This producer setup is separate from uploading skills into Claude.

For the other environments, return to [the host chooser](usage.md).
