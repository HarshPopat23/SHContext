# Parsers

- `syntax.ts`: fixed JS/TS dialect shared by scan and structural extraction.
- `javascript.ts`: declarations, functions/classes, imports/exports and evidence;
  Babel scopes suppress shadowed or reassigned require calls.
- `locations.ts`: raw UTF-8 byte offsets and inclusive line ranges.
- `configuration.ts`: bounded package/TypeScript JSON facts and declarations.

No source, repository plugins, configs or scripts are executed. Unsupported text
and failed syntax keep explicit fallbacks. See [scope and checks](../../docs/code-structure.md).
