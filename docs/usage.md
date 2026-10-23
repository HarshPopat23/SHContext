# Use SHContext in your coding assistant

Choose the guide for the place where your agent actually runs. A local path in
one environment does not give another environment access to the repository.

| Environment                              | Start here                                        | Source input                          | Generation                                                    |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Claude Code terminal                     | [Terminal walkthrough](claude-code.md)            | Local checkout                        | Five local plugin skills; active Claude session writes drafts |
| Claude web chat at claude.ai             | [Web chat walkthrough](claude-web.md)             | Uploaded source ZIP                   | Four uploaded web skills; active chat writes drafts           |
| Antigravity IDE                          | [Antigravity walkthrough](antigravity.md)         | Local checkout available to the agent | Explicit local host protocol; agent writes drafts             |
| Claude Code on the web at claude.ai/code | [Cloud session walkthrough](claude-code-cloud.md) | Checkout in its cloud environment     | Explicit host protocol in that environment                    |

**Claude web chat and Claude Code on the web are different products/surfaces.**
The ZIP upload route belongs to ordinary Claude chat. A terminal plugin installed
on your computer is not automatically available to a cloud Code session.

## What every walkthrough produces

For the Headlamp example, choose `headlamp/frontend/src/lib/router` as the
analysis root. The output lives at
`headlamp/frontend/src/lib/router/context/CONTEXT.md`, with child folders mirrored
under `context/` when present. The web workflow returns this tree inside a ZIP;
local workflows write it beside the selected source.

Each summary includes purpose, files, interfaces, dependencies, tests, source
references and uncertainty. The manifest/report/cache under `context/.shcontext/`
are part of the output: keep them for freshness checks and incremental reuse.
They are different from private operational state under a target's root
`.shcontext/` or an outside session directory.

Start small. Selecting the router folder does not establish the behavior of
Headlamp's entire authentication system. JS/TS structure is supported; other code
can be inventory-only. Unresolved imports remain unconfirmed, including `.js`
imports whose only possible target is a `.ts` file. See
[language and resolution limits](code-structure.md).

## Keys, accounts and cost

All four guides use `provider.id: host`. The active assistant analyzes evidence;
SHContext handles scanning, validation, freshness and publication. This requires
no separate OpenAI/Anthropic generation key, but consumes the host account's
normal allowance. A model label such as `antigravity-session` is declared
provenance, not authentication or an exact detected model ID.

The plain `build` and `update` CLI commands are the separate optional OpenAI API
workflow. Host generation instead uses `prepare` → agent-authored JSON → `submit`
→ `finalize`. Do not substitute an API command when following these guides.
Verify and query are local operations. Account policy, permissions and rate limits
still apply; SHContext does not supply unlimited model access.

## Support and evidence

| Surface            | Evidence and limits                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code plugin | Official CLI installation checks and local host-protocol exercises; see [skill evaluation](skill-evaluation.md)                 |
| Claude web chat    | Actual uploaded-skill/source, build/download/new-chat update and failure checks; see [web acceptance](claude-web-acceptance.md) |
| Antigravity        | Documented use of the shared local protocol; no dedicated Antigravity plugin or actual IDE acceptance result is claimed         |
| Claude Code cloud  | Environment-specific setup instructions; no actual cloud-session acceptance result is claimed                                   |

Review citations against source. A `fresh` result validates integrity and source
identity, not every explanation or runtime behavior. Generated context is not
committed automatically; decide with your team whether reviewed context belongs
in Git. Do not commit secrets or private session state.

## Further reading

- [Host protocol and bounds](host-generation.md)
- [Configuration and scanner exclusions](scanner.md)
- [Freshness and recovery](verification.md)
- [Optional unattended API generation](generation.md)
