import {
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  IncrementalCacheSchema,
  CACHE_PATH,
  type IncrementalCache,
} from '../update/cache.js';
import { renderFolder } from '../generation/render.js';
import { strictJson } from '../validation/json.js';
import { inspectSummary } from '../validation/summary.js';
import type {
  GenerationManifest,
  RepositoryInventory,
} from '../core/contracts/index.js';
import { policyIdentity, inputIdentity } from '../scanner/identity.js';
import { generationId } from '../generation/summarize.js';
import { BuildError } from '../generation/errors.js';
import {
  GenerationManifestSchema,
  RepositoryInventorySchema,
  includedFolder,
  needsManifestFile,
  isPartial,
} from '../core/contracts/index.js';
import { contextPath } from '../core/contracts/primitives.js';
import {
  assertContained,
  byteOrder,
  digest,
  readBounded,
  decode,
} from '../scanner/filesystem.js';

const manifestPath = '.shcontext/manifest.json';
const maxArtifactBytes = 32 * 1_048_576;
const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
const fail = () =>
  new BuildError(
    'output_ownership',
    'Output or operational state is unowned, edited, linked or incomplete. Move user files aside or recover the recorded transaction before building.',
  );
function regular(root: string, path: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail();
  const read = readBounded(root, path, maxArtifactBytes);
  if (read.oversized) throw fail();
  return read.bytes;
}
function directory(root: string, path: string): void {
  assertContained(root, path);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail();
}
/** Validate every named byte and derive expected folders/files from the persisted inventory. No API needed. */
export interface OwnedSnapshot {
  identity: string;
  manifest: GenerationManifest;
  inventory: RepositoryInventory;
  summaries: Map<string, string>;
  cache: IncrementalCache | null;
}
export function readOwnedTree(
  root: string,
  tree = join(root, 'context'),
): OwnedSnapshot | null {
  try {
    if (!exists(tree)) return null;
    directory(root, tree);
    if (!readdirSync(tree).length) return null;
    const manifestBytes = regular(root, join(tree, manifestPath));
    const manifest = GenerationManifestSchema.parse(
      strictJson(decode(manifestBytes)),
    );
    const report = RepositoryInventorySchema.parse(
      strictJson(decode(regular(root, join(tree, '.shcontext/report.json')))),
    );
    if (
      report.input_id !== manifest.input_id ||
      report.coverage !== manifest.coverage
    )
      throw fail();
    const policy = policyIdentity(
      manifest.selection.configuration,
      manifest.selection.control_files,
      manifest.generation.default_policy,
      manifest.generation.detector,
    );
    if (
      inputIdentity(policy, report.entries) !== manifest.input_id ||
      generationId(manifest.generation) !== manifest.generator.generation_id
    )
      throw fail();
    if (report.entries.length > manifest.selection.configuration.maxEntries)
      throw fail();
    const hashedFiles = report.entries.filter(
      (entry) => entry.kind === 'file' && entry.sha256 !== null,
    );
    if (
      hashedFiles.some(
        (entry) => entry.bytes! > manifest.selection.configuration.maxFileBytes,
      ) ||
      hashedFiles.reduce((total, entry) => total + entry.bytes!, 0) >
        manifest.selection.configuration.maxInputBytes
    )
      throw fail();
    for (const control of manifest.selection.control_files) {
      const entry = report.entries.find((item) => item.path === control.path);
      if (entry?.sha256 && entry.sha256 !== control.sha256) throw fail();
    }
    const folders = report.entries
      .flatMap((entry) => {
        const path = includedFolder(entry);
        return path === null ? [] : [path];
      })
      .sort(byteOrder);
    if (
      JSON.stringify(folders) !==
      JSON.stringify(manifest.directories.map((item) => item.path))
    )
      throw fail();
    const selected = report.entries
      .filter(needsManifestFile)
      .map(({ path, sha256, disposition, reason, mode }) => ({
        path,
        sha256,
        disposition,
        reason,
        mode,
      }));
    if (JSON.stringify(selected) !== JSON.stringify(manifest.files))
      throw fail();
    if (
      JSON.stringify(
        report.entries
          .filter(isPartial)
          .map((item) => [item.path, item.reason]),
      ) !==
      JSON.stringify(
        manifest.analysis_failures.map((item) => [item.path, item.code]),
      )
    )
      throw fail();
    for (const folder of manifest.directories) {
      const partial = report.entries.some(
        (entry) =>
          (folder.path === '.' ||
            entry.path === `${folder.path}/` ||
            entry.path.startsWith(`${folder.path}/`)) &&
          isPartial(entry),
      );
      if (folder.coverage !== (partial ? 'partial' : 'complete')) throw fail();
    }
    const expectedFiles = new Set([
      manifestPath,
      ...manifest.outputs.map((item) => item.path.slice(8)),
    ]);
    const expectedDirectories = new Set(['', '.shcontext']);
    for (const file of expectedFiles) {
      let parent = dirname(file);
      while (parent !== '.') {
        expectedDirectories.add(parent.replaceAll('\\', '/'));
        parent = dirname(parent);
      }
    }
    let entries = 0,
      totalBytes = manifestBytes.length;
    const summaries = new Map<string, string>();
    let cacheText: string | undefined;
    function walk(path: string) {
      directory(root, path ? join(tree, path) : tree);
      for (const name of readdirSync(path ? join(tree, path) : tree)) {
        if (++entries > 100_000) throw fail();
        const rel = path ? `${path}/${name}` : name,
          absolute = join(tree, rel);
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) throw fail();
        if (stat.isDirectory()) {
          if (!expectedDirectories.delete(rel)) throw fail();
          walk(rel);
        } else {
          if (!expectedFiles.delete(rel)) throw fail();
          const bytes = regular(root, absolute);
          totalBytes += bytes.length;
          if (totalBytes > 64 * 1_048_576) throw fail();
          if (rel === '.shcontext/cache.json') cacheText = decode(bytes);
          if (rel.endsWith('CONTEXT.md'))
            summaries.set(`context/${rel}`, decode(bytes));
          if (
            rel !== manifestPath &&
            digest(bytes) !==
              manifest.outputs.find((item) => item.path === `context/${rel}`)
                ?.sha256
          )
            throw fail();
        }
      }
    }
    walk('');
    expectedDirectories.delete('');
    if (
      expectedFiles.size ||
      expectedDirectories.size ||
      folders.some(
        (path) =>
          !manifest.outputs.some((item) => item.path === contextPath(path)),
      )
    )
      throw fail();
    for (const folder of manifest.directories)
      inspectSummary(
        summaries.get(contextPath(folder.path))!,
        folder,
        manifest,
        report,
      );
    let cache: IncrementalCache | null = null;
    if (manifest.outputs.some((item) => item.path === CACHE_PATH)) {
      cache = IncrementalCacheSchema.parse(strictJson(cacheText!));
      if (
        cache.input_id !== manifest.input_id ||
        cache.generation_id !== manifest.generator.generation_id ||
        JSON.stringify(
          cache.folders.map((item) => item.summary.source_path),
        ) !== JSON.stringify(folders) ||
        cache.folders.some(
          (item) =>
            renderFolder(item.summary) !==
            summaries.get(contextPath(item.summary.source_path)),
        )
      )
        throw fail();
    }
    return {
      cache,
      identity: digest(manifestBytes),
      manifest,
      inventory: report,
      summaries,
    };
  } catch (error) {
    if (error instanceof BuildError) throw error;
    throw fail();
  }
}

/** Ownership and format validation shared by the writer and offline verifier. */
export function inspectOwnedTree(
  root: string,
  tree = join(root, 'context'),
): string | null {
  return readOwnedTree(root, tree)?.identity ?? null;
}

const JournalSchema = z.strictObject({
  version: z.literal(1),
  token: z.string().uuid(),
  phase: z.enum(['pending', 'validated']),
  old: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .nullable(),
  next: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
type Journal = z.infer<typeof JournalSchema>;
function writeJournal(state: string, journal: Journal): void {
  const temporary = join(state, 'journal.tmp');
  if (exists(temporary)) throw fail();
  writeFileSync(temporary, JSON.stringify(journal), {
    flag: 'wx',
    mode: 0o600,
    flush: true,
  });
  renameSync(temporary, join(state, 'journal.json'));
}
function assertIdentity(
  root: string,
  path: string,
  identity: string | null,
): void {
  if (inspectOwnedTree(root, path) !== identity) throw fail();
}
function removeOwned(root: string, path: string, identity: string): void {
  // Deletion is resumable too. Keep the identity-bearing manifest until last;
  // after a cleanup crash, remaining bytes must still match the journal's tree.
  directory(root, path);
  const namedManifest = join(path, manifestPath);
  if (!exists(namedManifest)) {
    const names = readdirSync(path);
    if (names.length === 1 && names[0] === '.shcontext') {
      directory(root, join(path, '.shcontext'));
      if (readdirSync(join(path, '.shcontext')).length) throw fail();
      rmdirSync(join(path, '.shcontext'));
    } else if (names.length) throw fail();
    rmdirSync(path);
    return;
  }
  const bytes = regular(root, namedManifest);
  if (digest(bytes) !== identity) throw fail();
  const manifest = GenerationManifestSchema.parse(
    JSON.parse(bytes.toString('utf8')),
  );
  const files = new Map(
    manifest.outputs.map((item) => [item.path.slice(8), item.sha256]),
  );
  files.set(manifestPath, identity);
  const directories = new Set<string>();
  for (const file of files.keys()) {
    let parent = dirname(file).replaceAll('\\', '/');
    while (parent !== '.') {
      directories.add(parent);
      parent = dirname(parent).replaceAll('\\', '/');
    }
  }
  const presentFiles: string[] = [],
    presentDirectories: string[] = [];
  function walk(relative: string) {
    const absolute = relative ? join(path, relative) : path;
    directory(root, absolute);
    for (const name of readdirSync(absolute)) {
      const item = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(join(path, item));
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        if (!directories.has(item)) throw fail();
        walk(item);
        presentDirectories.push(item);
      } else {
        if (
          !files.has(item) ||
          digest(regular(root, join(path, item))) !== files.get(item)
        )
          throw fail();
        presentFiles.push(item);
      }
    }
  }
  walk('');
  for (const file of presentFiles.filter((item) => item !== manifestPath))
    rmSync(join(path, file));
  for (const folder of presentDirectories.filter(
    (item) => item !== '.shcontext',
  ))
    rmdirSync(join(path, folder));
  rmSync(namedManifest);
  rmdirSync(join(path, '.shcontext'));
  rmdirSync(path);
}

/** Called only under the single-writer lock. Unknown entries are never cleaned up. */
export function recoverPublication(root: string): void {
  const state = join(root, '.shcontext');
  directory(root, state);
  const journalFile = join(state, 'journal.json');
  const allowed = new Set(['build.lock', 'journal.json', 'journal.tmp']);
  if (!exists(journalFile)) {
    if (readdirSync(state).some((name) => name !== 'build.lock')) throw fail();
    return;
  }
  let journal: Journal;
  try {
    journal = JournalSchema.parse(
      JSON.parse(regular(root, journalFile).toString('utf8')),
    );
  } catch {
    throw fail();
  }
  const stageName = `stage-${journal.token}`,
    backupName = `backup-${journal.token}`;
  allowed.add(stageName);
  allowed.add(backupName);
  if (readdirSync(state).some((name) => !allowed.has(name))) throw fail();
  const stage = join(state, stageName),
    backup = join(state, backupName),
    context = join(root, 'context');
  // A crashed atomic journal update may leave the old phase plus a complete temp.
  if (exists(join(state, 'journal.tmp'))) {
    const next = JournalSchema.parse(
      JSON.parse(regular(root, join(state, 'journal.tmp')).toString('utf8')),
    );
    if (
      next.token !== journal.token ||
      next.old !== journal.old ||
      next.next !== journal.next
    )
      throw fail();
    // Only a committed rename certifies validation. Conservatively use the old phase.
    rmSync(join(state, 'journal.tmp'));
  }
  if (journal.phase === 'validated') {
    assertIdentity(root, context, journal.next);
    if (exists(backup)) {
      if (journal.old === null) throw fail();
      removeOwned(root, backup, journal.old);
    }
    if (exists(stage)) removeOwned(root, stage, journal.next);
  } else {
    if (exists(backup)) {
      if (journal.old === null) throw fail();
      assertIdentity(root, backup, journal.old);
      if (exists(context)) removeOwned(root, context, journal.next);
      renameSync(backup, context);
    } else if (journal.old === null) {
      if (exists(context)) removeOwned(root, context, journal.next);
    } else assertIdentity(root, context, journal.old);
    if (exists(stage)) removeOwned(root, stage, journal.next);
  }
  rmSync(journalFile);
}

export async function withPublicationLock<T>(
  root: string,
  work: (initial: string | null) => Promise<T>,
): Promise<T> {
  const state = join(root, '.shcontext'),
    lock = join(state, 'build.lock');
  if (!exists(state)) mkdirSync(state, { mode: 0o700 });
  directory(root, state);
  const token = randomUUID();
  // Serialize creation and dead-process reclamation too: two reclaimers must not
  // unlink a newly acquired live lock after both observed the same dead owner.
  const claim = join(state, 'claim.lock');
  try {
    writeFileSync(claim, token, { flag: 'wx', mode: 0o600, flush: true });
  } catch {
    throw new BuildError(
      'build_locked',
      'Another process is claiming the publication lock. An interrupted claim requires manual inspection.',
    );
  }
  try {
    if (exists(lock)) {
      let pid: number;
      try {
        const value = JSON.parse(regular(root, lock).toString('utf8')) as {
          pid?: number;
          token?: string;
        };
        if (
          !Number.isSafeInteger(value.pid) ||
          value.pid! < 1 ||
          !z.string().uuid().safeParse(value.token).success
        )
          throw fail();
        pid = value.pid!;
      } catch {
        throw fail();
      }
      try {
        process.kill(pid, 0);
        throw new BuildError(
          'build_locked',
          'Another build owns the publication lock.',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
      rmSync(lock);
    }
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
    } catch {
      throw new BuildError(
        'build_locked',
        'Another build owns the publication lock.',
      );
    }
  } finally {
    if (regular(root, claim).toString('utf8') !== token) throw fail();
    rmSync(claim);
  }
  try {
    recoverPublication(root);
    return await work(inspectOwnedTree(root));
  } finally {
    // Do not unlink a lock replaced by someone else.
    try {
      if (
        (JSON.parse(regular(root, lock).toString('utf8')) as { token?: string })
          .token === token
      )
        rmSync(lock);
    } catch {
      /* Leave uncertain state for manual inspection. */
    }
  }
}

export function publish(
  root: string,
  outputs: Map<string, string>,
  initial: string | null,
  beforeSwap: () => void,
): void {
  const state = join(root, '.shcontext'),
    token = randomUUID();
  const stage = join(state, `stage-${token}`),
    backup = join(state, `backup-${token}`),
    context = join(root, 'context');
  assertIdentity(root, context, initial);
  // Staging itself is not published. Partial staging failures are removed only by this writer.
  mkdirSync(stage, { mode: 0o700 });
  let journalWritten = false;
  try {
    for (const [path, content] of outputs) {
      const relative = path.slice(8);
      if (
        !path.startsWith('context/') ||
        relative
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        relative.includes('\\')
      )
        throw fail();
      const destination = join(stage, relative);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      assertContained(root, dirname(destination));
      writeFileSync(destination, content, {
        flag: 'wx',
        mode: 0o644,
        flush: true,
      });
    }
    const next = inspectOwnedTree(root, stage);
    if (!next) throw fail();
    beforeSwap();
    assertIdentity(root, context, initial);
    writeJournal(state, {
      version: 1,
      token,
      phase: 'pending',
      old: initial,
      next,
    });
    journalWritten = true;
    if (exists(context)) {
      if (initial === null) {
        if (readdirSync(context).length) throw fail();
        rmdirSync(context);
      } else renameSync(context, backup);
    }
    renameSync(stage, context);
    assertIdentity(root, context, next);
    writeJournal(state, {
      version: 1,
      token,
      phase: 'validated',
      old: initial,
      next,
    });
    recoverPublication(root);
  } catch (error) {
    if (journalWritten) {
      try {
        recoverPublication(root);
      } catch {
        throw new BuildError(
          'publication_recovery',
          'Publication stopped with an incomplete journal. Preserve .shcontext/ and context/ for recovery; do not delete uncertain files.',
        );
      }
    } else {
      // No other writer can legitimately use our private stage; do not follow inserted links.
      try {
        directory(root, stage);
        rmSync(stage, { recursive: true });
      } catch {
        /* Preserve uncertain staging. */
      }
    }
    if (error instanceof BuildError) throw error;
    throw new BuildError(
      'publication_failed',
      'Could not publish context; previous owned output was retained or restored.',
    );
  }
}
