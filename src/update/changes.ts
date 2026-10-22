import { spawnSync } from 'node:child_process';
import type { RepositoryInventory } from '../core/contracts/index.js';
import { byteOrder, decode } from '../scanner/filesystem.js';

export interface SourceChanges {
  added: string[];
  modified: string[];
  deleted: string[];
  moves: {
    from: string;
    to: string;
    basis: 'identical-content' | 'git-rename-hint';
  }[];
}
function git(root: string, args: string[]): string | null {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  const result = spawnSync(
    'git',
    [
      '--no-optional-locks',
      '--literal-pathspecs',
      '-c',
      'core.fsmonitor=false',
      '-C',
      root,
      ...args,
    ],
    {
      env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      timeout: 10000,
      maxBuffer: 4 * 1_048_576,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) return null;
  try {
    return decode(result.stdout);
  } catch {
    return null;
  }
}
export function gitHead(root: string): string | null {
  const head = git(root, ['rev-parse', '--verify', 'HEAD'])?.trim();
  return head && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ? head : null;
}
/** Hash/disposition changes are authoritative; move labels are supplementary hints. */
export function sourceChanges(
  root: string,
  previous: RepositoryInventory | null,
  current: RepositoryInventory,
  head: string | null,
): SourceChanges {
  const selected = (inventory: RepositoryInventory | null) =>
    new Map(
      (inventory?.entries ?? [])
        .filter(
          (item) => item.kind === 'file' && item.disposition !== 'ignored',
        )
        .map((item) => [item.path, item]),
    );
  const old = selected(previous),
    next = selected(current);
  const added = [...next.keys()]
    .filter((path) => !old.has(path))
    .sort(byteOrder);
  const deleted = [...old.keys()]
    .filter((path) => !next.has(path))
    .sort(byteOrder);
  const identity = (item: RepositoryInventory['entries'][number]) =>
    JSON.stringify([
      item.kind,
      item.disposition,
      item.reason,
      item.mode,
      item.sha256,
    ]);
  const modified = [...next.keys()]
    .filter(
      (path) =>
        old.has(path) && identity(old.get(path)!) !== identity(next.get(path)!),
    )
    .sort(byteOrder);
  const moves: SourceChanges['moves'] = [];
  for (const from of deleted) {
    const hash = old.get(from)!.sha256;
    if (!hash) continue;
    const sources = deleted.filter((path) => old.get(path)!.sha256 === hash);
    const targets = added.filter((path) => next.get(path)!.sha256 === hash);
    if (sources.length === 1 && targets.length === 1)
      moves.push({ from, to: targets[0]!, basis: 'identical-content' });
  }
  // Limit rename work and argument bytes. Missing/shallow Git metadata falls back to hashes.
  const candidates = [...deleted, ...added];
  if (
    head &&
    deleted.length &&
    added.length &&
    candidates.length <= 1000 &&
    Buffer.byteLength(candidates.join('\0')) < 32000
  ) {
    const output = git(root, [
      'diff',
      '--relative',
      '--name-status',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      '--find-renames=50%',
      '-l1000',
      '--diff-filter=R',
      head,
      '--',
      ...candidates,
    ]);
    const records = output?.split('\0') ?? [];
    for (let i = 0; i + 2 < records.length;) {
      const status = records[i++]!,
        from = records[i++]!,
        to = records[i++]!;
      if (
        !/^R[0-9]+$/.test(status) ||
        !deleted.includes(from) ||
        !added.includes(to)
      )
        continue;
      if (!moves.some((move) => move.from === from || move.to === to))
        moves.push({ from, to, basis: 'git-rename-hint' });
    }
  }
  return {
    added,
    modified,
    deleted,
    moves: moves.sort(
      (a, b) => byteOrder(a.from, b.from) || byteOrder(a.to, b.to),
    ),
  };
}
