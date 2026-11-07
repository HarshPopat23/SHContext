import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { getProjectInfo } from '../core/index.js';
import { contextPath } from '../core/contracts/primitives.js';
import { scanRepository } from '../scanner/index.js';
import { readBounded, digest, decode } from '../scanner/filesystem.js';
import { sensitiveContent } from '../scanner/content.js';
import { readOwnedTree } from '../storage/publication.js';
import { verifyRepository } from '../validation/index.js';
import { queryRepository } from '../query/index.js';
import { folderStatus } from '../status/index.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_CITE_LINES = 200;
const MAX_LINE_LENGTH = 400;

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      error: { code: number; message: string };
    };
interface ToolOutput {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
class ToolError extends Error {}

const control =
  /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g;
const text = (value: unknown): ToolOutput => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});
const fail = (message: string): ToolOutput => ({
  ...text(message),
  isError: true,
});

export const TOOLS = [
  {
    name: 'ctx_status',
    description:
      'Per-folder freshness of the generated context. Call this first. Trust a folder summary only when its state is "fresh"; read source directly for stale or new folders. Offline and read-only.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'ctx_query',
    description:
      'Search the repository by path, symbol, text and generated summaries with hash-checked source references. Returns the repository-wide freshness state alongside results. Offline and read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', maxLength: 500 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        depth: { type: 'integer', minimum: 0, maximum: 3 },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'ctx_folder',
    description:
      'Read the generated context document for one source folder ("." for the root). The result states whether that folder is fresh; the text is a navigation aid, so confirm important claims with ctx_cite.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', maxLength: 1024 } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'ctx_cite',
    description:
      'Return the current source lines behind a citation (path, start_line, end_line). Pass the citation sha256 to learn whether the file is unchanged since the context was generated. Only files the scanner analyzed can be read.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', maxLength: 1024 },
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
        sha256: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
      },
      required: ['path', 'start_line', 'end_line'],
      additionalProperties: false,
    },
  },
  {
    name: 'ctx_verify',
    description:
      'Repository-wide mechanical verification (fresh, stale, unknown or invalid) with findings. Offline and read-only. Fresh never certifies explanation accuracy.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value || value.length > 1024)
    throw new ToolError(`"${key}" must be a nonempty string.`);
  return value;
}
function int(
  args: Record<string, unknown>,
  key: string,
  required: boolean,
): number | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new ToolError(`"${key}" must be an integer.`);
  return value;
}
function noExtra(args: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(args).find((key) => !allowed.includes(key));
  if (extra) throw new ToolError(`Unexpected argument "${extra}".`);
}

function cite(root: string, args: Record<string, unknown>): ToolOutput {
  noExtra(args, ['path', 'start_line', 'end_line', 'sha256']);
  const path = str(args, 'path');
  const start = int(args, 'start_line', true)!;
  const end = int(args, 'end_line', true)!;
  if (start < 1 || end < start)
    throw new ToolError('Need 1 <= start_line <= end_line.');
  if (
    args['sha256'] !== undefined &&
    !/^sha256:[0-9a-f]{64}$/.test(String(args['sha256']))
  )
    throw new ToolError('"sha256" must look like sha256:<64 hex>.');
  // Only paths the scanner itself selected for analysis are readable.
  const scan = scanRepository(root);
  const entry = scan.inventory.entries.find(
    (item) =>
      item.kind === 'file' &&
      item.path === path &&
      item.disposition === 'analyzed',
  );
  if (!entry)
    throw new ToolError(
      'That path is not an analyzed file of this repository (excluded, ignored, unsupported or absent).',
    );
  const read = readBounded(
    root,
    join(root, entry.path),
    scan.configuration.maxFileBytes,
  );
  if (read.oversized || digest(read.bytes) !== entry.sha256)
    throw new ToolError('The file changed while reading; retry.');
  const body = decode(read.bytes, true);
  if (sensitiveContent(body))
    throw new ToolError('The file is withheld by the credential policy.');
  const lines = body.split(/\r\n|[\n\r\u2028\u2029]/u);
  if (start > lines.length)
    throw new ToolError(`The file has only ${lines.length} lines.`);
  const last = Math.min(end, lines.length, start + MAX_CITE_LINES - 1);
  const snippet = lines
    .slice(start - 1, last)
    .map(
      (line, index) =>
        `${start + index}: ${line.slice(0, MAX_LINE_LENGTH).replace(control, '�')}`,
    )
    .join('\n');
  const supplied = args['sha256'] as string | undefined;
  return text({
    path: entry.path,
    current_sha256: entry.sha256,
    unchanged_since_citation:
      supplied === undefined ? null : supplied === entry.sha256,
    start_line: start,
    end_line: last,
    truncated: last < Math.min(end, lines.length),
    excerpt: snippet,
  });
}
function folder(root: string, args: Record<string, unknown>): ToolOutput {
  noExtra(args, ['path']);
  const path = str(args, 'path').replace(/\/+$/, '') || '.';
  const snapshot = readOwnedTree(root);
  if (!snapshot)
    throw new ToolError('No context exists yet. Run shcontext build.');
  if (!snapshot.manifest.directories.some((item) => item.path === path))
    throw new ToolError(
      'No context document exists for that folder. Call ctx_status for the list of folders.',
    );
  const status = folderStatus(root);
  const item = status.folders.find((entry) => entry.path === path);
  const document = snapshot.summaries.get(contextPath(path));
  if (document === undefined)
    throw new ToolError('The context document could not be read.');
  return text({
    path,
    context_path: contextPath(path),
    freshness: item?.state ?? 'unknown',
    stale_reasons: item?.reasons ?? [],
    changed_files: item?.changed_files ?? [],
    trust:
      item?.state === 'fresh'
        ? 'Matches current source identity; still verify important claims with ctx_cite.'
        : 'Do not rely on this summary for the changed files; read source directly.',
    document: document.replace(control, '�'),
  });
}

/** Run one tool. Thrown errors become MCP tool errors, never protocol errors. */
export function callTool(
  selectedRoot: string,
  name: string,
  args: Record<string, unknown> = {},
): ToolOutput {
  try {
    const root = realpathSync(selectedRoot);
    switch (name) {
      case 'ctx_status':
        noExtra(args, []);
        return text(folderStatus(root));
      case 'ctx_verify':
        noExtra(args, []);
        return text(verifyRepository(root));
      case 'ctx_query': {
        noExtra(args, ['question', 'limit', 'depth']);
        const limit = int(args, 'limit', false);
        const depth = int(args, 'depth', false);
        return text(
          queryRepository(root, str(args, 'question'), {
            ...(limit !== undefined ? { limit } : {}),
            ...(depth !== undefined ? { depth } : {}),
          }),
        );
      }
      case 'ctx_folder':
        return folder(root, args);
      case 'ctx_cite':
        return cite(root, args);
      default:
        return fail(`Unknown tool "${name}".`);
    }
  } catch (error) {
    if (error instanceof ToolError) return fail(error.message);
    const code = (error as { code?: unknown } | null)?.code;
    return fail(
      `Tool failed${typeof code === 'string' ? ` (${code})` : ''}; the repository may be changing or the context unreadable. Nothing was modified.`,
    );
  }
}

/** Transport-independent request handler. Returns null for notifications. */
export function handleMessage(
  root: string,
  message: unknown,
): RpcResponse | null {
  const request = message as RpcRequest;
  const valid =
    typeof request === 'object' &&
    request !== null &&
    request.jsonrpc === '2.0' &&
    typeof request.method === 'string';
  if (!valid)
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid request.' },
    };
  const isNotification = request.id === undefined;
  const id = request.id ?? null;
  const reply = (result: unknown): RpcResponse | null =>
    isNotification ? null : { jsonrpc: '2.0', id, result };
  switch (request.method) {
    case 'initialize': {
      const asked = request.params?.['protocolVersion'];
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(String(asked))
          ? asked
          : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'shcontext', version: getProjectInfo().version },
        instructions:
          'Call ctx_status first. Trust generated summaries only for folders reported fresh; confirm important claims with ctx_cite.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const params = request.params ?? {};
      const args = params['arguments'];
      if (
        typeof params['name'] !== 'string' ||
        (args !== undefined &&
          (typeof args !== 'object' || args === null || Array.isArray(args)))
      )
        return isNotification
          ? null
          : {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Invalid tool call parameters.' },
            };
      return reply(
        callTool(root, params['name'], (args ?? {}) as Record<string, unknown>),
      );
    }
    default:
      if (isNotification || request.method.startsWith('notifications/'))
        return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found.' },
      };
  }
}

/** Newline-delimited JSON-RPC over streams. stdout carries protocol messages only. */
export function serveStdio(
  root: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<void> {
  return new Promise((resolve) => {
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      let response: RpcResponse | null;
      try {
        response = handleMessage(root, JSON.parse(line));
      } catch (error) {
        response =
          error instanceof SyntaxError
            ? {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error.' },
              }
            : {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: 'Internal error.' },
              };
      }
      if (response) output.write(`${JSON.stringify(response)}\n`);
    });
    lines.on('close', resolve);
  });
}
