# Skill package evaluation

Acceptance checks were defined before implementation using the requested
[unlazy workflow](https://github.com/Leonxlnx/unlazy). Package tests and model
judgment have different evidence boundaries.

## Activation boundaries

A fresh native reviewer received only five skill names/descriptions and
38 requests. Expected labels, skill bodies, the repository and author conclusions
were withheld. The requests contain three ordinary positives and three negatives
per workflow, plus eight cross-workflow/negation/quoted/advice-only cases. The
reviewer returned the declared skill sets for **38 of 38 requests**.

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
remain untested without an authorized key. Separate package smoke tests install
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
