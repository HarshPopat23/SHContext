import { posix } from 'node:path';
import { builtinModules } from 'node:module';
import type {
  ConfigurationRecord,
  DependencyEdge,
  FileAnalysis,
  InventoryEntry,
  RepositoryInventory,
  EntryPoint,
} from '../core/contracts/index.js';
import type { EntryDeclaration } from '../parsers/configuration.js';
export const RESOLVER_VERSION = 'relative-files-v1';
const extensions = [
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.json',
  '.d.ts',
  '.d.mts',
  '.d.cts',
];
const included = (e: InventoryEntry) =>
  e.kind === 'file' &&
  ['analyzed', 'inventory-only', 'parse-error'].includes(e.disposition);
interface InventoryIndex {
  files: Set<string>;
  blocked: Set<string>;
}
function indexInventory(inventory: RepositoryInventory): InventoryIndex {
  return {
    files: new Set(inventory.entries.filter(included).map((e) => e.path)),
    blocked: new Set([
      'context',
      '.shcontext',
      ...inventory.entries
        .filter(
          (e) =>
            !['analyzed', 'inventory-only', 'parse-error'].includes(
              e.disposition,
            ),
        )
        .map((e) => e.path.replace(/\/$/, '')),
    ]),
  };
}
function excluded(path: string, index: InventoryIndex): boolean {
  const parts = path.split('/');
  for (let count = 1; count <= parts.length; count++)
    if (index.blocked.has(parts.slice(0, count).join('/'))) return true;
  return false;
}
function locate(
  from: string,
  specifier: string,
  index: InventoryIndex,
  exact: boolean,
): {
  to: string | null;
  reason:
    | 'outside_root'
    | 'unsupported_resolution'
    | 'missing_target'
    | 'excluded_target'
    | 'ambiguous'
    | null;
} {
  if (posix.isAbsolute(specifier) || /^[A-Za-z]:[\\/]/.test(specifier))
    return { to: null, reason: 'outside_root' };
  if (/[\\:?#%\u0000-\u001f]/.test(specifier) || !specifier)
    return { to: null, reason: 'unsupported_resolution' };
  const path = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (
    path === '..' ||
    path.startsWith('../') ||
    posix.isAbsolute(specifier) ||
    /^[A-Za-z]:/.test(specifier)
  )
    return { to: null, reason: 'outside_root' };
  const directory = specifier.endsWith('/') || path === '.';
  if (exact && directory) return { to: null, reason: 'unsupported_resolution' };
  const indexFiles = extensions.map((e) => posix.join(path, 'index' + e));
  const candidates = exact
    ? [path]
    : directory
      ? indexFiles
      : posix.extname(path)
        ? [path]
        : [path, ...extensions.map((e) => path + e), ...indexFiles];
  const matches = candidates.filter((candidate) => index.files.has(candidate));
  if (matches.length > 1) return { to: null, reason: 'ambiguous' };
  if (candidates.some((p) => excluded(p, index)))
    return { to: null, reason: 'excluded_target' };
  return matches.length === 1
    ? { to: matches[0]!, reason: null }
    : { to: null, reason: 'missing_target' };
}
function matchesAlias(specifier: string, pattern: string): boolean {
  const parts = pattern.split('*');
  return parts.length === 1
    ? specifier === pattern
    : parts.length === 2 &&
        specifier.startsWith(parts[0]!) &&
        specifier.endsWith(parts[1]!);
}
export function buildDependencies(
  analyses: FileAnalysis[],
  inventory: RepositoryInventory,
  configuration: ConfigurationRecord[],
): DependencyEdge[] {
  const index = indexInventory(inventory);
  return analyses.flatMap((analysis) =>
    analysis.references.map((reference) => {
      const base = {
          schema_version: 1 as const,
          from: analysis.path,
          reference,
        },
        specifier = reference.specifier;
      if (specifier === null)
        return {
          ...base,
          resolution: 'unresolved' as const,
          to: null,
          reason: 'computed' as const,
        };
      if (
        specifier === '.' ||
        specifier === '..' ||
        specifier.startsWith('./') ||
        specifier.startsWith('../')
      ) {
        const result = locate(analysis.path, specifier, index, false);
        return result.to
          ? {
              ...base,
              resolution: 'resolved' as const,
              to: result.to,
              reason: null,
            }
          : {
              ...base,
              resolution: 'unresolved' as const,
              to: null,
              reason: result.reason!,
            };
      }
      if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier))
        return {
          ...base,
          resolution: 'unresolved' as const,
          to: null,
          reason: 'outside_root' as const,
        };
      if (specifier.startsWith('node:'))
        return {
          ...base,
          resolution: 'external' as const,
          to: null,
          reason: 'external_builtin' as const,
        };
      const visible = configuration.filter(
        (c) =>
          c.format === 'typescript-jsonc' &&
          (posix.dirname(c.path) === '.' ||
            analysis.path.startsWith(posix.dirname(c.path) + '/')),
      );
      const alias =
        specifier.startsWith('#') ||
        specifier.startsWith('@/') ||
        specifier.startsWith('~/') ||
        visible.some(
          (c) =>
            c.diagnostics.length > 0 ||
            c.facts.some(
              (f) =>
                f.kind === 'compiler-extends' ||
                (f.kind === 'compiler-option' &&
                  f.pointer === '/compilerOptions/baseUrl') ||
                (f.kind === 'path-alias' &&
                  matchesAlias(
                    specifier,
                    f.pointer
                      .split('/')
                      .at(-1)!
                      .replaceAll('~1', '/')
                      .replaceAll('~0', '~'),
                  )),
            ),
        );
      if (alias)
        return {
          ...base,
          resolution: 'unresolved' as const,
          to: null,
          reason: 'alias' as const,
        };
      if (specifier.startsWith('node:') || builtinModules.includes(specifier))
        return {
          ...base,
          resolution: 'external' as const,
          to: null,
          reason: 'external_builtin' as const,
        };
      if (
        !specifier ||
        specifier.startsWith('.') ||
        /[\\:#?%\s]/.test(specifier) ||
        !/^(?:@[^/]+\/[^/]+|[a-zA-Z0-9_][^/]*)(?:\/[^/]+)*$/.test(specifier)
      )
        return {
          ...base,
          resolution: 'unresolved' as const,
          to: null,
          reason: 'unsupported_resolution' as const,
        };
      return {
        ...base,
        resolution: 'external' as const,
        to: null,
        reason: 'external_package' as const,
      };
    }),
  );
}
export function matchEntryPoints(
  declarations: EntryDeclaration[],
  inventory: RepositoryInventory,
): EntryPoint[] {
  const index = indexInventory(inventory);
  return declarations.map((declaration) => {
    const result = declaration.specifier.includes('*')
      ? { to: null, reason: 'pattern' as const }
      : locate(declaration.evidence.path, declaration.specifier, index, true);
    return {
      ...declaration,
      resolution: result.to ? 'resolved' : 'unresolved',
      to: result.to,
      reason:
        result.reason === 'ambiguous'
          ? 'unsupported_resolution'
          : result.reason,
    };
  });
}
