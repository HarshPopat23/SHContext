import { lstatSync, opendirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import {
  FilePathSchema,
  FolderPathSchema,
  RepositoryInventorySchema,
  countInventory,
  isPartial,
  type EffectiveConfig,
  type InventoryEntry,
  type RepositoryInventory,
} from '../core/contracts/index.js';
import { readControl, loadConfiguration } from './configuration.js';
import {
  assertContained,
  byteOrder,
  decode,
  digest,
  errorCode,
  readBounded,
} from './filesystem.js';
import { tracking } from './git.js';
import {
  classify,
  DEFAULT_POLICY_VERSION,
  DETECTOR_VERSION,
  PARSER_VERSION,
} from './content.js';
import { ScanError } from './errors.js';
import type { ControlFile } from './types.js';
export { ScanError } from './errors.js';
export { DEFAULT_CONFIGURATION } from './types.js';
export type { ControlFile } from './types.js';

export interface ScanResult {
  inventory: RepositoryInventory;
  configuration: EffectiveConfig;
  control_files: ControlFile[];
  policy_id: string;
  versions: { default_policy: string; detector: string; parser: string };
}
const noise = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  'target',
]);
const lockfiles = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'poetry.lock',
  'uv.lock',
]);
const vcs = new Set(['.git', '.hg', '.svn']);
const sensitiveName =
  /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|.*\.(?:pem|key|p12|pfx)|id_rsa.*|id_ed25519.*)$/i;
interface RuleScope {
  prefix: string;
  rules: Ignore;
}
function ignored(path: string, scopes: RuleScope[]): boolean {
  let excluded = false;
  for (const scope of scopes) {
    const local = path.slice(scope.prefix.length);
    const result = scope.rules.test(local);
    if (result.ignored) excluded = true;
    if (result.unignored) excluded = false;
  }
  return excluded;
}
function tuples(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.entries(value)
      .sort(([a], [b]) => byteOrder(a, b))
      .map(([key, item]) => [key, tuples(item)]);
  return value;
}
/** Read current working-tree bytes. Never writes files or invokes a model. */
export function scanRepository(selectedRoot: string): ScanResult {
  if (!selectedRoot)
    throw new ScanError(
      'invalid_root',
      'Select a repository directory explicitly.',
    );
  let root: string;
  try {
    const requested = resolve(selectedRoot),
      stat = lstatSync(requested);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    root = realpathSync(requested);
  } catch {
    throw new ScanError(
      'invalid_root',
      'The selected root must be a readable real directory.',
    );
  }
  const controls = new Map<string, ControlFile>(),
    cache = new Map<string, string>();
  const configuration = loadConfiguration(
    readControl(root, 'shcontext.config.json', controls, cache),
  );
  const shRules = ignore({ ignorecase: false }).add(
    readControl(root, '.shcontextignore', controls, cache) ?? '',
  );
  const tracked = tracking(root);
  const entries: InventoryEntry[] = [];
  const folded = new Set<string>();
  let inputBytes = 0;
  function add(entry: InventoryEntry): void {
    if (entries.length >= configuration.maxEntries)
      throw new ScanError(
        'entry_limit',
        'Discovered entries exceed maxEntries; narrow the selected root or exclusions.',
      );
    entries.push(entry);
  }
  function visit(
    folder: string,
    scopes: RuleScope[],
    blockedGit: boolean,
  ): void {
    const absolute = folder === '.' ? root : join(root, folder);
    const directoryPath = folder === '.' ? '.' : `${folder}/`;
    const directory: InventoryEntry = {
      kind: 'directory',
      path: directoryPath,
      disposition: 'analyzed',
      reason: 'directory_enumerated',
      mode: 'none',
      bytes: null,
      sha256: null,
      diagnostics: [],
    };
    add(directory);
    let names: string[];
    try {
      assertContained(root, absolute);
      // Node supports raw names; @types/node 22 omits this encoding overload.
      const handle = opendirSync(absolute, {
        encoding: 'buffer' as BufferEncoding,
      });
      names = [];
      try {
        for (
          let item = handle.readSync();
          item !== null;
          item = handle.readSync()
        ) {
          try {
            names.push(decode(Buffer.from(item.name)));
          } catch {
            throw new ScanError(
              'unsupported_path',
              'A filename is not valid UTF-8.',
            );
          }
          if (entries.length + names.length > configuration.maxEntries + 2)
            throw new ScanError(
              'entry_limit',
              'Discovered entries exceed maxEntries; narrow the selected root or exclusions.',
            );
        }
      } finally {
        handle.closeSync();
      }
      assertContained(root, absolute);
    } catch (error) {
      if (error instanceof ScanError) throw error;
      if (folder === '.')
        throw new ScanError(
          'root_unreadable',
          'Cannot enumerate the selected root.',
        );
      directory.disposition = 'unreadable';
      directory.reason = 'directory_unreadable';
      directory.diagnostics.push({
        code: errorCode(error),
        message: 'Cannot enumerate this directory; descendants are unknown.',
      });
      return;
    }
    const prefix = folder === '.' ? '' : `${folder}/`;
    const controlPath = `${prefix}.gitignore`;
    const text = readControl(root, controlPath, controls, cache);
    // Absent nested ignore files are not control identities. Root absence is meaningful.
    if (folder !== '.' && text === null) controls.delete(controlPath);
    const nextScopes =
      text === null
        ? scopes
        : [
            ...scopes,
            { prefix, rules: ignore({ ignorecase: false }).add(text) },
          ];
    for (const name of names.sort(byteOrder)) {
      const path = `${prefix}${name}`,
        location = join(absolute, name);
      let stat;
      try {
        stat = lstatSync(location);
      } catch (error) {
        throw new ScanError(
          'source_changed',
          'A discovered entry could not be inspected; rerun against a stable directory.',
          FilePathSchema.safeParse(path).success ? path : null,
        );
      }
      if (
        folder === '.' &&
        ['context', '.shcontext'].includes(name.toLowerCase())
      ) {
        if (stat.isSymbolicLink())
          throw new ScanError(
            'output_symlink',
            'Reserved output/state paths must not be symlinks.',
          );
        if (name !== name.toLowerCase())
          throw new ScanError(
            'path_collision',
            'A root path collides with a reserved output/state name.',
          );
        continue;
      }
      const directory = stat.isDirectory(),
        reportPath = directory ? `${path}/` : path;
      if (
        !(directory ? FolderPathSchema : FilePathSchema).safeParse(path).success
      )
        throw new ScanError(
          'unsupported_path',
          'A source name cannot be represented by the portable path contract.',
        );
      const key = path.toLowerCase();
      if (folded.has(key))
        throw new ScanError(
          'path_collision',
          'Source paths collide after case folding.',
        );
      folded.add(key);
      const common = {
        path: reportPath,
        disposition: 'skipped' as const,
        reason: 'special_file' as const,
        mode: 'none' as const,
        sha256: null,
        diagnostics: [],
      };
      const entry: InventoryEntry = directory
        ? { ...common, kind: 'directory', bytes: null }
        : {
            ...common,
            kind: 'file',
            bytes: Number.isSafeInteger(stat.size) ? stat.size : null,
          };
      const finish = (
        disposition: InventoryEntry['disposition'],
        reason: InventoryEntry['reason'],
      ) => {
        entry.disposition = disposition;
        entry.reason = reason;
        add(entry);
      };
      if (stat.isSymbolicLink()) {
        finish('skipped', 'symlink');
        continue;
      }
      if (vcs.has(name.toLowerCase())) {
        finish('ignored', 'vcs_metadata');
        continue;
      }
      if (!directory && !stat.isFile()) {
        finish('skipped', 'special_file');
        continue;
      }
      if (directory) {
        let nested = tracked.submodules.has(path);
        try {
          lstatSync(join(location, '.git'));
          nested = true;
        } catch (error) {
          if (errorCode(error) !== 'ENOENT')
            throw new ScanError(
              'repository_boundary',
              'Cannot inspect a potential nested repository boundary.',
              reportPath,
            );
        }
        if (nested) {
          finish('skipped', 'nested_repository');
          continue;
        }
      }
      if (sensitiveName.test(name)) {
        finish('ignored', 'sensitive_path');
        continue;
      }
      if (directory && noise.has(name.toLowerCase())) {
        finish('ignored', 'noise_directory');
        continue;
      }
      const gitIgnored = blockedGit || ignored(reportPath, nextScopes);
      const trackedHere = directory
        ? tracked.ancestors.has(path)
        : tracked.files.has(path);
      if (gitIgnored && !trackedHere) {
        finish('ignored', 'gitignore');
        continue;
      }
      if (shRules.ignores(reportPath)) {
        finish('ignored', 'shcontextignore');
        continue;
      }
      if (directory) {
        visit(path, nextScopes, gitIgnored);
        continue;
      }
      if (lockfiles.has(name.toLowerCase())) {
        finish('skipped', 'lockfile');
        continue;
      }
      if (
        /\.(?:png|jpe?g|gif|webp|ico|bmp|avif|pdf|zip|gz|tgz|tar|7z|rar|woff2?|ttf|eot|mp[34]|wav|ogg|mov|exe|dll|so|dylib|wasm)$/i.test(
          name,
        )
      ) {
        finish('skipped', 'binary');
        continue;
      }
      if (/\.map$/i.test(name)) {
        finish('skipped', 'source_map');
        continue;
      }
      if (stat.size > configuration.maxFileBytes) {
        finish('skipped', 'too_large');
        continue;
      }
      let bytes: Buffer;
      try {
        const read = readBounded(root, location, configuration.maxFileBytes);
        if (read.oversized) {
          finish('skipped', 'too_large');
          continue;
        }
        bytes = read.bytes;
        const controlHash = cache.get(path);
        if (controlHash && controlHash !== digest(bytes))
          throw new ScanError(
            'source_changed',
            'Selection-control file changed during discovery.',
            path,
          );
      } catch (error) {
        if (error instanceof ScanError) throw error;
        entry.diagnostics.push({
          code: errorCode(error),
          message: 'Cannot read this file; content is unknown.',
        });
        entry.bytes = null;
        finish(
          'unreadable',
          ['EACCES', 'EPERM'].includes(errorCode(error))
            ? 'permission_denied'
            : 'read_failed',
        );
        continue;
      }
      if (bytes.includes(0)) {
        finish('skipped', 'binary');
        continue;
      }
      let text: string;
      try {
        text = decode(bytes);
      } catch {
        finish('skipped', 'non_utf8');
        continue;
      }
      inputBytes += bytes.length;
      if (inputBytes > configuration.maxInputBytes)
        throw new ScanError(
          'input_limit',
          'Readable selected bytes exceed maxInputBytes; narrow the selected root or exclusions.',
        );
      Object.assign(entry, classify(path, text));
      entry.bytes = bytes.length;
      if (
        ['analyzed', 'inventory-only', 'parse-error'].includes(
          entry.disposition,
        )
      )
        entry.sha256 = digest(bytes);
      add(entry);
    }
  }
  visit('.', [], false);
  entries.sort((a, b) => byteOrder(a.path, b.path));
  // Recheck selection controls, including explicit absent root files, before returning.
  for (const control of controls.values()) {
    const verify = new Map<string, ControlFile>();
    readControl(root, control.path, verify, new Map());
    if (verify.get(control.path)?.sha256 !== control.sha256)
      throw new ScanError(
        'source_changed',
        'Selection-control file changed during discovery.',
        control.path,
      );
  }
  const control_files = [...controls.values()].sort((a, b) =>
    byteOrder(a.path, b.path),
  );
  const policy_id = digest(
    JSON.stringify([
      'policy-v1',
      tuples(configuration),
      control_files.map((file) => [file.path, file.sha256]),
      DEFAULT_POLICY_VERSION,
      DETECTOR_VERSION,
    ]),
  );
  const input_id = digest(
    JSON.stringify([
      'input-v1',
      policy_id,
      entries.map((entry) => [
        entry.path,
        entry.kind,
        entry.disposition,
        entry.reason,
        entry.mode,
        entry.sha256,
      ]),
    ]),
  );
  const inventory = RepositoryInventorySchema.parse({
    schema_version: 1,
    input_id,
    coverage: entries.some(isPartial) ? 'partial' : 'complete',
    entries,
    counts: countInventory(entries),
    diagnostics: [],
    policy_exclusions: ['context/', '.shcontext/'],
  });
  return {
    inventory,
    configuration,
    control_files,
    policy_id,
    versions: {
      default_policy: DEFAULT_POLICY_VERSION,
      detector: DETECTOR_VERSION,
      parser: PARSER_VERSION,
    },
  };
}
