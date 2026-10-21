import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const SchemaVersionSchema = z.literal(SCHEMA_VERSION);
export const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const TextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
export const UIntSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const PositiveIntSchema = UIntSchema.min(1);
export const CoverageSchema = z.enum(['complete', 'partial']);
export const ModeSchema = z.enum([
  'structural',
  'text',
  'configuration',
  'inventory-only',
  'none',
]);
export const DispositionSchema = z.enum([
  'analyzed',
  'inventory-only',
  'ignored',
  'skipped',
  'unreadable',
  'parse-error',
]);
export type Coverage = z.infer<typeof CoverageSchema>;

// Metadata is portable, never an absolute path or an encoded URL. Preserve Unicode.
const relativePath = z
  .string()
  .min(1)
  .refine((value) => {
    if (/[\\:\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
    if (Buffer.from(value).toString('utf8') !== value) return false;
    return value
      .split('/')
      .every(
        (segment) => segment !== '' && segment !== '.' && segment !== '..',
      );
  }, 'Expected a portable root-relative path.');
export const RelativePathSchema = relativePath;
function allowedSource(value: string): boolean {
  return !['context', '.shcontext'].includes(
    value.split('/')[0]?.toLowerCase() ?? '',
  );
}
export const FilePathSchema = relativePath.refine(
  (value) =>
    allowedSource(value) &&
    !value
      .split('/')
      .slice(0, -1)
      .some((part) => part.toLowerCase() === 'context.md'),
  'Reserved source path.',
);
export const FolderPathSchema = z.union([
  z.literal('.'),
  relativePath.refine(
    (value) =>
      allowedSource(value) &&
      !value.split('/').some((part) => part.toLowerCase() === 'context.md'),
    'Reserved source folder.',
  ),
]);
export const DirectoryEntryPathSchema = z
  .string()
  .refine(
    (value) =>
      value === '.' ||
      (value.endsWith('/') &&
        FolderPathSchema.safeParse(value.slice(0, -1)).success),
    'Directory paths need a trailing slash, except root.',
  );
export const ReportPathSchema = z.union([
  z.literal('.'),
  relativePath,
  z
    .string()
    .refine(
      (value) =>
        value.endsWith('/') &&
        relativePath.safeParse(value.slice(0, -1)).success,
    ),
]);
export const DiagnosticSchema = z.strictObject({
  code: TextSchema,
  message: TextSchema,
});
export const ProviderIdentitySchema = z.strictObject({
  id: TextSchema,
  model: TextSchema,
});
export const EffectiveConfigSchema = z
  .strictObject({
    version: SchemaVersionSchema,
    maxFileBytes: PositiveIntSchema,
    maxInputBytes: PositiveIntSchema,
    maxEntries: PositiveIntSchema,
    folderWordLimit: PositiveIntSchema,
    rootWordLimit: PositiveIntSchema,
    provider: ProviderIdentitySchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.maxInputBytes < value.maxFileBytes)
      issue(
        ctx,
        ['maxInputBytes'],
        'invalid_manifest',
        'Total input limit cannot be smaller than the file limit.',
      );
  });
export type EffectiveConfig = z.infer<typeof EffectiveConfigSchema>;

export const FindingCodeSchema = z.enum([
  'schema_violation',
  'invalid_order',
  'duplicate_identity',
  'invalid_inventory',
  'invalid_analysis',
  'invalid_dependency',
  'invalid_evidence',
  'invalid_summary',
  'invalid_manifest',
  'inconsistent_bundle',
  'unknown_contract',
  'source_changed',
  'selection_changed',
  'generation_changed',
  'input_unreadable',
  'output_missing',
  'output_modified',
  'manifest_invalid',
  'path_collision',
  'unsupported_path',
]);
export type FindingCode = z.infer<typeof FindingCodeSchema>;
export function issue(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  code: FindingCode,
  message: string,
): void {
  ctx.addIssue({
    code: 'custom',
    path,
    message,
    params: { finding_code: code },
  });
}
export function orderedUnique(
  values: string[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value))
      issue(
        ctx,
        [...path, index],
        'duplicate_identity',
        'Identity must be unique within its collection.',
      );
    seen.add(value);
    const previous = values[index - 1];
    if (
      previous !== undefined &&
      Buffer.compare(Buffer.from(previous), Buffer.from(value)) > 0
    )
      issue(
        ctx,
        [...path, index],
        'invalid_order',
        'Path-keyed collections must use UTF-8 byte order.',
      );
  });
}
export function folderOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '.' : path.slice(0, index);
}
export function contextPath(folder: string): string {
  return folder === '.' ? 'context/CONTEXT.md' : `context/${folder}/CONTEXT.md`;
}

export const SourceSpanShape = {
  path: FilePathSchema,
  sha256: HashSchema,
  start_line: PositiveIntSchema,
  end_line: PositiveIntSchema,
  symbol: TextSchema.nullable(),
  basis: z.enum(['source', 'configuration', 'documentation']),
};
export const SourceSpanSchema = z
  .strictObject(SourceSpanShape)
  .superRefine((span, ctx) => {
    if (span.end_line < span.start_line)
      issue(
        ctx,
        ['end_line'],
        'invalid_evidence',
        'Evidence ends before it starts.',
      );
  });
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
