import { z } from 'zod';
import {
  CoverageSchema,
  DiagnosticSchema,
  DirectoryEntryPathSchema,
  DispositionSchema,
  FilePathSchema,
  HashSchema,
  ModeSchema,
  SchemaVersionSchema,
  UIntSchema,
  issue,
  orderedUnique,
} from './primitives.js';

export const ReasonSchema = z.enum([
  'directory_enumerated',
  'supported_source',
  'supported_text',
  'supported_configuration',
  'unsupported_language',
  'gitignore',
  'shcontextignore',
  'noise_directory',
  'sensitive_path',
  'tool_output',
  'vcs_metadata',
  'binary',
  'non_utf8',
  'lockfile',
  'source_map',
  'symlink',
  'special_file',
  'nested_repository',
  'too_large',
  'sensitive_content',
  'permission_denied',
  'read_failed',
  'directory_unreadable',
  'syntax_error',
  'parser_failed',
]);
const common = {
  disposition: DispositionSchema,
  reason: ReasonSchema,
  mode: ModeSchema,
  diagnostics: z.array(DiagnosticSchema),
};
export const InventoryEntrySchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...common,
      kind: z.literal('file'),
      path: FilePathSchema,
      bytes: UIntSchema.nullable(),
      sha256: HashSchema.nullable(),
    }),
    z.strictObject({
      ...common,
      kind: z.literal('directory'),
      path: DirectoryEntryPathSchema,
      bytes: z.null(),
      sha256: z.null(),
    }),
  ])
  .superRefine((entry, ctx) => {
    const allowed: Record<string, readonly string[]> = {
      analyzed:
        entry.kind === 'directory'
          ? ['directory_enumerated']
          : ['supported_source', 'supported_text', 'supported_configuration'],
      'inventory-only': ['unsupported_language'],
      ignored: [
        'gitignore',
        'shcontextignore',
        'noise_directory',
        'sensitive_path',
        'tool_output',
        'vcs_metadata',
      ],
      skipped: [
        'binary',
        'non_utf8',
        'lockfile',
        'source_map',
        'symlink',
        'special_file',
        'nested_repository',
        'too_large',
        'sensitive_content',
      ],
      unreadable:
        entry.kind === 'directory'
          ? ['directory_unreadable']
          : ['permission_denied', 'read_failed'],
      'parse-error': ['syntax_error', 'parser_failed'],
    };
    if (!allowed[entry.disposition]?.includes(entry.reason))
      issue(
        ctx,
        ['reason'],
        'invalid_inventory',
        'Reason does not match the disposition.',
      );
    const readable =
      ['analyzed', 'inventory-only', 'parse-error'].includes(
        entry.disposition,
      ) && entry.kind === 'file';
    const mode =
      entry.disposition === 'inventory-only'
        ? 'inventory-only'
        : entry.disposition === 'parse-error'
          ? 'structural'
          : entry.reason === 'supported_source'
            ? 'structural'
            : entry.reason === 'supported_text'
              ? 'text'
              : entry.reason === 'supported_configuration'
                ? 'configuration'
                : 'none';
    if (entry.mode !== mode)
      issue(
        ctx,
        ['mode'],
        'invalid_inventory',
        'Mode does not match the disposition and reason.',
      );
    if (readable && (entry.sha256 === null || entry.bytes === null))
      issue(
        ctx,
        ['sha256'],
        'invalid_inventory',
        'Readable selected text needs a size and byte digest.',
      );
    if (!readable && entry.sha256 !== null)
      issue(
        ctx,
        ['sha256'],
        'invalid_inventory',
        'Excluded or unreadable content cannot carry a byte digest.',
      );
    if (
      entry.kind === 'directory' &&
      ['inventory-only', 'parse-error'].includes(entry.disposition)
    )
      issue(
        ctx,
        ['disposition'],
        'invalid_inventory',
        'This disposition is file-only.',
      );
    if (
      entry.kind === 'directory' &&
      entry.disposition === 'skipped' &&
      entry.reason !== 'nested_repository'
    )
      issue(
        ctx,
        ['reason'],
        'invalid_inventory',
        'A skipped real directory must be a repository boundary.',
      );
    if (
      entry.kind === 'file' &&
      ['noise_directory', 'nested_repository', 'directory_unreadable'].includes(
        entry.reason,
      )
    )
      issue(
        ctx,
        ['reason'],
        'invalid_inventory',
        'This reason describes a real directory boundary.',
      );
    if (
      ['parse-error', 'unreadable'].includes(entry.disposition) &&
      entry.diagnostics.length === 0
    )
      issue(
        ctx,
        ['diagnostics'],
        'invalid_inventory',
        'Analysis/access failure needs a diagnostic.',
      );
  });
export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;

const counts = z.strictObject({
  analyzed: UIntSchema,
  'inventory-only': UIntSchema,
  ignored: UIntSchema,
  skipped: UIntSchema,
  unreadable: UIntSchema,
  'parse-error': UIntSchema,
});
export const InventoryCountsSchema = z.strictObject({
  files: counts,
  directories: counts,
});
export function isPartial(entry: InventoryEntry): boolean {
  return (
    ['inventory-only', 'unreadable', 'parse-error'].includes(
      entry.disposition,
    ) || ['too_large', 'sensitive_content'].includes(entry.reason)
  );
}
export function needsFileAnalysis(entry: InventoryEntry): boolean {
  return (
    entry.kind === 'file' &&
    ['analyzed', 'inventory-only', 'parse-error'].includes(entry.disposition)
  );
}
export function needsManifestFile(entry: InventoryEntry): boolean {
  return (
    entry.kind === 'file' &&
    (needsFileAnalysis(entry) ||
      entry.disposition === 'unreadable' ||
      ['too_large', 'sensitive_content'].includes(entry.reason))
  );
}
export function includedFolder(entry: InventoryEntry): string | null {
  return entry.kind === 'directory' &&
    ['analyzed', 'unreadable'].includes(entry.disposition)
    ? entry.path === '.'
      ? '.'
      : entry.path.slice(0, -1)
    : null;
}
export function countInventory(
  entries: InventoryEntry[],
): z.infer<typeof InventoryCountsSchema> {
  const empty = {
    analyzed: 0,
    'inventory-only': 0,
    ignored: 0,
    skipped: 0,
    unreadable: 0,
    'parse-error': 0,
  };
  const value = { files: { ...empty }, directories: { ...empty } };
  for (const entry of entries)
    value[entry.kind === 'file' ? 'files' : 'directories'][entry.disposition]++;
  return value;
}
export const RepositoryInventorySchema = z
  .strictObject({
    schema_version: SchemaVersionSchema,
    input_id: HashSchema,
    coverage: CoverageSchema,
    entries: z.array(InventoryEntrySchema).min(1),
    counts: InventoryCountsSchema,
    diagnostics: z.array(DiagnosticSchema),
    policy_exclusions: z.tuple([
      z.literal('context/'),
      z.literal('.shcontext/'),
    ]),
  })
  .superRefine((value, ctx) => {
    orderedUnique(
      value.entries.map((entry) => entry.path),
      ctx,
      ['entries'],
    );
    const names = value.entries.map((entry) => entry.path.replace(/\/$/, ''));
    if (new Set(names).size !== names.length)
      issue(
        ctx,
        ['entries'],
        'duplicate_identity',
        'A path cannot be both a file and a directory.',
      );
    if (
      !value.entries.some(
        (entry) =>
          entry.kind === 'directory' &&
          entry.path === '.' &&
          entry.disposition === 'analyzed',
      )
    )
      issue(
        ctx,
        ['entries'],
        'invalid_inventory',
        'The root must have an enumerated directory entry.',
      );
    const expected = countInventory(value.entries);
    for (const kind of ['files', 'directories'] as const)
      for (const disposition of DispositionSchema.options)
        if (value.counts[kind][disposition] !== expected[kind][disposition])
          issue(
            ctx,
            ['counts', kind, disposition],
            'invalid_inventory',
            'Observed-entry count does not match inventory.',
          );
    if (
      value.coverage !==
      (value.entries.some(isPartial) ? 'partial' : 'complete')
    )
      issue(
        ctx,
        ['coverage'],
        'invalid_inventory',
        'Coverage does not match observed limitations.',
      );
    const directories = new Map(
      value.entries
        .filter((entry) => entry.kind === 'directory')
        .map((entry) => [entry.path, entry]),
    );
    for (const [index, entry] of value.entries.entries()) {
      if (entry.path === '.') continue;
      const segments = entry.path.replace(/\/$/, '').split('/');
      for (let count = 1; count < segments.length; count++) {
        const parent = directories.get(
          `${segments.slice(0, count).join('/')}/`,
        );
        if (!parent || parent.disposition !== 'analyzed')
          issue(
            ctx,
            ['entries', index, 'path'],
            'invalid_inventory',
            'An observed descendant needs enumerated, unpruned ancestors.',
          );
      }
    }
  });
export type RepositoryInventory = z.infer<typeof RepositoryInventorySchema>;
