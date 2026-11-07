import { realpathSync } from 'node:fs';
import type { VerificationResult } from '../core/contracts/index.js';
import { contextPath, folderOf } from '../core/contracts/primitives.js';
import { scanRepository } from '../scanner/index.js';
import { readOwnedTree } from '../storage/publication.js';
import { verifyRepository } from '../validation/index.js';

export type FolderStaleReason =
  'modified' | 'added' | 'deleted' | 'selection_changed' | 'generation_changed';
export interface FolderStatus {
  /** Source folder path, `.` for the repository root. */
  path: string;
  /** Owned context document that describes this folder. */
  context_path: string;
  state: 'fresh' | 'stale';
  reasons: FolderStaleReason[];
  /** Up to 20 changed source files in this folder's subtree, in path order. */
  changed_files: string[];
}
export interface StatusResult {
  schema_version: 1;
  /**
   * `current`: every folder matches. `stale`: some folders need a refresh.
   * `missing`/`invalid`/`unknown`: per-folder comparison was not possible.
   */
  state: 'current' | 'stale' | 'missing' | 'invalid' | 'unknown';
  verify: VerificationResult['state'];
  coverage: VerificationResult['coverage'];
  folders: FolderStatus[];
  /** Folders that hold new source files but have no context document yet. */
  new_folders: string[];
  counts: { fresh: number; stale: number };
  note: string;
}

const MAX_LISTED = 20;
const inSubtree = (folder: string, path: string) =>
  folder === '.' || path.startsWith(`${folder}/`);

/**
 * Per-folder freshness, derived from the same recorded inventory that
 * `verifyRepository` checks. Read-only and offline. It tells an agent which
 * folder summaries are still trustworthy, which a single repository-wide
 * `fresh|stale` state cannot do. Like `verify`, `current` is a mechanical
 * statement about source identity and never about explanation accuracy.
 */
export function folderStatus(selectedRoot: string): StatusResult {
  const verify = verifyRepository(selectedRoot);
  const base = {
    schema_version: 1 as const,
    verify: verify.state,
    coverage: verify.coverage,
    folders: [] as FolderStatus[],
    new_folders: [] as string[],
    counts: { fresh: 0, stale: 0 },
  };
  const codes = new Set(verify.findings.map((finding) => finding.code));
  if (verify.state === 'invalid') {
    const missing = codes.has('output_missing');
    return {
      ...base,
      state: missing ? 'missing' : 'invalid',
      note: missing
        ? 'No context exists yet. Run shcontext build (or the host prepare/submit/finalize flow).'
        : 'Context is invalid or a build is incomplete. Preserve it and inspect shcontext verify output.',
    };
  }
  if (verify.state === 'unknown')
    return {
      ...base,
      state: 'unknown',
      note: 'Some inputs are unreadable, so per-folder freshness cannot be established.',
    };
  const root = realpathSync(selectedRoot);
  let snapshot: ReturnType<typeof readOwnedTree>;
  let current: ReturnType<typeof scanRepository>;
  try {
    snapshot = readOwnedTree(root);
    current = scanRepository(root);
  } catch {
    return {
      ...base,
      state: 'unknown',
      note: 'Context or source could not be compared consistently; retry on a stable tree.',
    };
  }
  if (!snapshot)
    return {
      ...base,
      state: 'missing',
      note: 'No context exists yet. Run shcontext build.',
    };

  const tuple = (entry: {
    kind: string;
    disposition: string;
    reason: string;
    mode: string;
    sha256: string | null;
  }) =>
    JSON.stringify([
      entry.kind,
      entry.disposition,
      entry.reason,
      entry.mode,
      entry.sha256,
    ]);
  const before = new Map(
    snapshot.inventory.entries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => [entry.path, entry]),
  );
  const after = new Map(
    current.inventory.entries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => [entry.path, entry]),
  );
  const changes = new Map<string, 'modified' | 'added' | 'deleted'>();
  for (const [path, entry] of after) {
    const old = before.get(path);
    if (!old) changes.set(path, 'added');
    // Losing access is a comparison failure, not evidence the bytes changed.
    else if (entry.disposition !== 'unreadable' && tuple(old) !== tuple(entry))
      changes.set(path, 'modified');
  }
  for (const path of before.keys())
    if (!after.has(path)) changes.set(path, 'deleted');

  const global: FolderStaleReason[] = [];
  if (codes.has('selection_changed')) global.push('selection_changed');
  if (codes.has('generation_changed')) global.push('generation_changed');

  const known = new Set(snapshot.manifest.directories.map((item) => item.path));
  const folders: FolderStatus[] = snapshot.manifest.directories.map(
    (directory) => {
      const touched = [...changes]
        .filter(([path]) => inSubtree(directory.path, path))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const reasons = [
        ...global,
        ...[...new Set(touched.map(([, reason]) => reason))].sort(),
      ];
      return {
        path: directory.path,
        context_path: contextPath(directory.path),
        state: reasons.length ? 'stale' : 'fresh',
        reasons,
        changed_files: touched.slice(0, MAX_LISTED).map(([path]) => path),
      };
    },
  );
  const newFolders = new Set<string>();
  for (const [path, reason] of changes) {
    if (reason !== 'added') continue;
    for (
      let folder = folderOf(path);
      folder !== '.' && !known.has(folder);
      folder = folderOf(folder)
    )
      newFolders.add(folder);
  }
  const stale = folders.filter((item) => item.state === 'stale').length;
  const state = stale || newFolders.size ? 'stale' : 'current';
  return {
    ...base,
    state,
    folders,
    new_folders: [...newFolders].sort(),
    counts: { fresh: folders.length - stale, stale },
    note:
      state === 'current'
        ? 'Every folder summary matches current source identity. This does not certify that the prose is accurate.'
        : 'Read context only for fresh folders; for stale folders and new folders read the source directly, or run shcontext update.',
  };
}
