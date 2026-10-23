# Skill package evaluation

Acceptance checks were defined before implementation using the requested
[unlazy workflow](https://github.com/Leonxlnx/unlazy). Package tests and model
judgment have different evidence boundaries.

## Activation boundaries

A fresh native reviewer received only five skill names/descriptions and
41 requests. Expected labels, skill bodies, the repository and author conclusions
were withheld. The requests contain three ordinary positives and three negatives
per workflow, plus cross-workflow/negation/quoted/advice-only cases and three host/no-key boundaries. The
reviewer returned the declared skill sets for **41 of 41 requests**.

[Observed decisions](examples/skills/routing-results.json) bind the metadata and
corpus with SHA-256 digests. `tests/skills.test.mjs` checks this binding, case
coverage and observed/expected decisions. It also rejects missing skills,
substituted names and escaping marketplace paths using known valid controls.
It does not implement a keyword router or call a model. Changed descriptions or
requests require a new independent evaluation, not edited predictions.

This small metadata exercise is not a statistical recall estimate or an
authenticated Claude model session. Explicit `/shcontext:context-…` commands
remain the reproducible invocation path. Another host/model can route differently;
evaluate it with the same corpus before relying on implicit activation. The
corpus is in
[`tests/fixtures/skills/activation.json`](https://github.com/HarshPopat23/SHContext/blob/main/tests/fixtures/skills/activation.json).

A separate fresh native agent used the query skill on a prepared TypeScript
fixture. It ran the documented query, inspected the cited source, explained
`expiresAt > now` accurately, and distinguished that expiry comparison from a
complete authentication system without writing files. This is a local workflow
forward-test, not execution in an authenticated Claude session.

## Active-host build/update forward use

A separate fresh native Codex agent followed only the updated build/update skills,
linked protocol and a two-folder TypeScript repository, with no expected summaries
or test-helper access and both model API key variables cleared. It authored three
structured drafts, finalized and verified complete/fresh context, changed a cart
discount from 10 to 20, then authored three affected drafts and verified fresh
again. Both folders were affected because the math summary includes incoming
consumer evidence from the edited cart file. The final source-based answer correctly
explained summing prices, applying 20 percent off and formatting two decimals.

[Observed fixture, decisions and source references](examples/skills/host-forward-results.json)
record the bounded result. The parent independently re-ran verification and checked
the current source/claims. The agent initially used an alternate draft filename;
the session allowlist rejected it, and it moved only its own draft to the prescribed
`response.json`. No tool-owned state or final Markdown was edited. That correction
is retained as an observed limitation, not hidden as first-attempt success.

This used an active Codex host, not authenticated Claude. The configured
`claude-code-session` is explicitly a declared provenance label, not evidence of
the model/account actually used. The local Claude Code CLI reports `loggedIn: false`
and `authMethod: none`, so authenticated Claude execution remains blocked here.

## Clean runtime installation

`npm run test:skills` copies repository-controlled source to a fresh temporary
directory with spaces in its path. It starts without `node_modules` or `dist`,
runs `npm ci` with a fresh cache and executes the documented operations:

- Actual CLI scan/build on an inventory-only target with zero provider requests.
- A nonempty TypeScript target generated with the public injectable adapter API
  and authored responses, then actual CLI verify/query with source matches.
- An edit making verify/query explicitly stale, a zero-cost cap refusing changed
  work without replacing the manifest, a controlled API update, and a
  credential-free CLI no-op update making zero calls.
- The source-checkout benchmark with its real assertions, leaving committed
  reports unchanged. Its controlled workload is described in [agents.md](agents.md).

Nonempty generation/update uses the library adapter deliberately; it is not a
live OpenAI CLI request. Live generation and independent model quality/billing
remain untested without an authorized key. The updated fresh source-install test also completes the host protocol walkthrough without model credentials. Separate package smoke tests install
a fresh CLI tarball and check all five skills, UI metadata, manifests and guides.

## Official host installation

Claude Code **2.1.308** validates the plugin with `--strict`, registers the local
marketplace, installs `shcontext@shcontext-workflows`, lists it enabled with all
five skill files present, and uninstalls it. A malformed-manifest control fails
validation. `npm run test:plugin` repeats this under a fresh `CLAUDE_CONFIG_DIR`,
outside the repository, with no model credentials or session. The CLI may display
a directory-listing advisory about an optional icon; that is separate from its
successful strict manifest validation. No public directory submission is claimed.

The dedicated CI job installs the pinned host CLI temporarily and runs this
integration. The Node 22/24 Linux/Windows matrix runs runtime/structural/package
tests. Host installation is tested on Linux; Windows runtime tests do not imply
a Windows Claude host integration run.

An authenticated Claude session's implicit activation and tool execution remain
unverified without host credentials. Metadata routing, native-agent forward use
and local host installation are distinct evidence. None establishes live-session
behavior or semantic correctness of generated context.
