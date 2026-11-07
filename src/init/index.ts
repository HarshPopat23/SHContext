import {
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export class InitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InitError';
  }
}
export interface InitOptions {
  /** Instruction files to maintain. Default: `AGENTS.md` only. */
  targets?: ('agents' | 'claude')[];
  /** Register the offline MCP server in `.mcp.json`. */
  mcp?: boolean;
  /** Add the files init writes to `.shcontextignore`. Default: true. */
  ignore?: boolean;
}
export interface InitChange {
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped';
  detail?: string;
}

export const BLOCK_START = '<!-- shcontext:start -->';
export const BLOCK_END = '<!-- shcontext:end -->';
export const INSTRUCTION_BLOCK = `${BLOCK_START}
## Repository context (SHContext)

This repository keeps generated, source-cited folder summaries in \`context/\`.
They are navigation aids, not proof of behavior.

1. Before working in a folder, read \`context/<folder>/CONTEXT.md\`
   (\`context/CONTEXT.md\` for the repository root). It lists each file's role,
   entry points, dependencies, and cites exact source lines.
2. Check freshness first: run \`shcontext status\` (or the \`ctx_status\` MCP tool).
   Trust a summary only for folders reported \`fresh\`. For \`stale\` or new
   folders, read the source directly.
3. Before relying on a claim that matters, open the cited lines and confirm.
4. To find code, try \`shcontext query "<question>"\` (or \`ctx_query\`) before
   broad searching. It is offline and read-only.
5. Never edit \`context/\` by hand. Refresh it with \`shcontext update .\`.
${BLOCK_END}
`;

function regularOrAbsent(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new InitError(
        'unsafe_target',
        `Refusing to modify ${path}: it is not an ordinary single-link file.`,
      );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
/** Write through a sibling temp file so an interrupted run never truncates the target. */
function write(path: string, text: string): void {
  const temp = `${path}.shcontext-tmp-${process.pid}`;
  writeFileSync(temp, text, { flag: 'wx', mode: 0o644 });
  renameSync(temp, path);
}
export function applyBlock(existing: string | null, block: string): string {
  if (existing === null) return block;
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  if (start !== -1 && end > start)
    return (
      existing.slice(0, start) +
      block.trimEnd() +
      existing.slice(end + BLOCK_END.length)
    );
  if (start !== -1 || end !== -1)
    throw new InitError(
      'broken_markers',
      'Found only one SHContext marker; fix or remove it manually.',
    );
  const body = existing.trimEnd();
  return body ? `${body}\n\n${block}` : block;
}
function instructionFile(root: string, name: string): InitChange {
  const path = join(root, name);
  const exists = regularOrAbsent(path);
  const old = exists ? readFileSync(path, 'utf8') : null;
  const next = applyBlock(old, INSTRUCTION_BLOCK);
  if (old === next) return { path: name, action: 'unchanged' };
  write(path, next);
  return { path: name, action: exists ? 'updated' : 'created' };
}
function mcpConfig(root: string): InitChange {
  const name = '.mcp.json';
  const path = join(root, name);
  const exists = regularOrAbsent(path);
  let data: { mcpServers?: Record<string, unknown> } = {};
  if (exists) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error();
      data = parsed as typeof data;
    } catch {
      throw new InitError(
        'invalid_mcp_config',
        '.mcp.json is not a JSON object; fix it before running init --mcp.',
      );
    }
  }
  const servers = data.mcpServers ?? {};
  if (typeof servers !== 'object' || Array.isArray(servers))
    throw new InitError(
      'invalid_mcp_config',
      '.mcp.json mcpServers is invalid.',
    );
  const wanted = { command: 'shcontext', args: ['mcp'] };
  const present = servers['shcontext'];
  if (present !== undefined) {
    return JSON.stringify(present) === JSON.stringify(wanted)
      ? { path: name, action: 'unchanged' }
      : {
          path: name,
          action: 'skipped',
          detail: 'An existing "shcontext" server entry was left unchanged.',
        };
  }
  data.mcpServers = { ...servers, shcontext: wanted };
  write(path, `${JSON.stringify(data, null, 2)}\n`);
  return { path: name, action: exists ? 'updated' : 'created' };
}
function ignoreFile(root: string, lines: string[]): InitChange {
  const name = '.shcontextignore';
  const path = join(root, name);
  const exists = regularOrAbsent(path);
  const old = exists ? readFileSync(path, 'utf8') : '';
  const have = new Set(old.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => !have.has(line));
  if (!missing.length) return { path: name, action: 'unchanged' };
  const prefix = old && !old.endsWith('\n') ? '\n' : '';
  write(path, `${old}${prefix}${missing.join('\n')}\n`);
  return { path: name, action: exists ? 'updated' : 'created' };
}

/**
 * Teach agents to use `context/`. Touches only AGENTS.md / CLAUDE.md (inside
 * marker comments), `.mcp.json` and `.shcontextignore`; never `context/` and
 * never source. Idempotent. Run it before the first build: these files are
 * ignored from analysis so editing them does not stale the context.
 */
export function initRepository(
  selectedRoot: string,
  options: InitOptions = {},
): InitChange[] {
  let root: string;
  try {
    const stat = lstatSync(selectedRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    root = realpathSync(selectedRoot);
  } catch {
    throw new InitError(
      'init_root',
      'The selected root must be a real, readable directory.',
    );
  }
  const targets = options.targets?.length ? options.targets : ['agents'];
  const names = [
    ...new Set(
      targets.map((t) => (t === 'claude' ? 'CLAUDE.md' : 'AGENTS.md')),
    ),
  ];
  const changes: InitChange[] = [];
  // Ignore rules first, so a later build never sees the edited files.
  if (options.ignore !== false) {
    const ignored = [...names, ...(options.mcp ? ['.mcp.json'] : [])];
    changes.push(ignoreFile(root, ignored));
  }
  for (const name of names) changes.push(instructionFile(root, name));
  if (options.mcp) changes.push(mcpConfig(root));
  return changes;
}
