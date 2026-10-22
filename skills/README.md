# Skills

The five installable workflows are `context-build`, `context-update`,
`context-verify`, `context-query` and `context-benchmark`. Each directory contains
`SKILL.md` and optional reader UI metadata. The Claude Code plugin discovers them
through the root `.claude-plugin/plugin.json`; the marketplace is
`shcontext-workflows`.

Follow the [installation, requirements and failure guide](../docs/skills.md).
Prepare a complete SHContext checkout with `npm ci` and expose its absolute path
as `SHCONTEXT_HOME`. Plugin installation alone does not install that runtime.
Build/changed update use the configured OpenAI provider; verify/query and the
controlled benchmark are local. MCP is not required for these CLI workflows.
