import { z } from 'zod';
import {
  DiagnosticSchema,
  FilePathSchema,
  HashSchema,
  PositiveIntSchema,
  SchemaVersionSchema,
  SourceSpanSchema,
  TextSchema,
  UIntSchema,
  issue,
} from './primitives.js';

const RangeSchema = z
  .strictObject({ start_line: PositiveIntSchema, end_line: PositiveIntSchema })
  .superRefine((value, ctx) => {
    if (value.end_line < value.start_line)
      issue(
        ctx,
        ['end_line'],
        'invalid_analysis',
        'Symbol ends before it starts.',
      );
  });
export const ExtractedSymbolSchema = z.strictObject({
  id: z.string().regex(/^S[1-9][0-9]*$/),
  name: TextSchema.nullable(),
  kind: z.enum([
    'function',
    'class',
    'interface',
    'type',
    'enum',
    'variable',
    'namespace',
  ]),
  exported: z.boolean(),
  range: RangeSchema,
});
export type ExtractedSymbol = z.infer<typeof ExtractedSymbolSchema>;
export const ReferenceKindSchema = z.enum([
  'import',
  're-export',
  'require',
  'dynamic-import',
]);
export const SourceReferenceSchema = z
  .strictObject({
    kind: ReferenceKindSchema,
    specifier: z.string().nullable(),
    start_byte: UIntSchema,
    end_byte: PositiveIntSchema,
    evidence: SourceSpanSchema,
  })
  .superRefine((value, ctx) => {
    if (value.end_byte <= value.start_byte)
      issue(
        ctx,
        ['end_byte'],
        'invalid_analysis',
        'Reference byte range must be nonempty and end-exclusive.',
      );
  });
export const DependencyEdgeSchema = z
  .discriminatedUnion('resolution', [
    z.strictObject({
      schema_version: SchemaVersionSchema,
      from: FilePathSchema,
      reference: SourceReferenceSchema,
      resolution: z.literal('resolved'),
      to: FilePathSchema,
      reason: z.null(),
    }),
    z.strictObject({
      schema_version: SchemaVersionSchema,
      from: FilePathSchema,
      reference: SourceReferenceSchema,
      resolution: z.literal('external'),
      to: z.null(),
      reason: z.enum(['external_package', 'external_builtin']),
    }),
    z.strictObject({
      schema_version: SchemaVersionSchema,
      from: FilePathSchema,
      reference: SourceReferenceSchema,
      resolution: z.literal('unresolved'),
      to: z.null(),
      reason: z.enum([
        'alias',
        'computed',
        'outside_root',
        'ambiguous',
        'excluded_target',
        'missing_target',
        'unsupported_resolution',
      ]),
    }),
  ])
  .superRefine((edge, ctx) => {
    if (
      edge.from !== edge.reference.evidence.path ||
      edge.reference.evidence.basis !== 'source'
    )
      issue(
        ctx,
        ['reference', 'evidence'],
        'invalid_dependency',
        'Dependency evidence must describe its source file.',
      );
    if (
      edge.reference.specifier === null &&
      !(edge.resolution === 'unresolved' && edge.reason === 'computed')
    )
      issue(
        ctx,
        ['reference', 'specifier'],
        'invalid_dependency',
        'A computed reference needs explicit unresolved status.',
      );
    if (
      edge.resolution === 'resolved' &&
      !edge.reference.specifier?.startsWith('.')
    )
      issue(
        ctx,
        ['reference', 'specifier'],
        'invalid_dependency',
        'v0.1 resolves only relative specifiers.',
      );
    if (
      edge.resolution === 'external' &&
      (edge.reference.specifier?.startsWith('.') ||
        edge.reference.specifier?.startsWith('/'))
    )
      issue(
        ctx,
        ['resolution'],
        'invalid_dependency',
        'Relative or absolute paths are not bare external packages.',
      );
  });
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;

export const FileAnalysisSchema = z
  .strictObject({
    schema_version: SchemaVersionSchema,
    path: FilePathSchema,
    sha256: HashSchema,
    line_count: UIntSchema,
    language: TextSchema,
    mode: z.enum(['structural', 'text', 'configuration', 'inventory-only']),
    disposition: z.enum(['analyzed', 'inventory-only', 'parse-error']),
    symbols: z.array(ExtractedSymbolSchema),
    references: z.array(SourceReferenceSchema),
    diagnostics: z.array(DiagnosticSchema),
  })
  .superRefine((value, ctx) => {
    if (
      (value.disposition === 'inventory-only') !==
      (value.mode === 'inventory-only')
    )
      issue(
        ctx,
        ['mode'],
        'invalid_analysis',
        'Inventory-only analysis needs the matching mode.',
      );
    if (
      value.mode === 'structural' &&
      !['javascript', 'typescript'].includes(value.language)
    )
      issue(
        ctx,
        ['language'],
        'invalid_analysis',
        'Only JavaScript and TypeScript have structural support in v0.1.',
      );
    if (
      value.disposition === 'parse-error' &&
      (value.mode !== 'structural' || value.diagnostics.length === 0)
    )
      issue(
        ctx,
        ['disposition'],
        'invalid_analysis',
        'Parser failures need structural mode and diagnostics.',
      );
    if (
      (value.mode !== 'structural' || value.disposition !== 'analyzed') &&
      (value.symbols.length > 0 || value.references.length > 0)
    )
      issue(
        ctx,
        ['symbols'],
        'invalid_analysis',
        'Unsupported, text-only or failed analysis cannot invent syntax facts.',
      );
    const ids = new Set<string>();
    value.symbols.forEach((symbol, index) => {
      if (ids.has(symbol.id))
        issue(
          ctx,
          ['symbols', index, 'id'],
          'duplicate_identity',
          'Symbol IDs must be unique per file.',
        );
      ids.add(symbol.id);
      if (symbol.range.end_line > value.line_count)
        issue(
          ctx,
          ['symbols', index, 'range'],
          'invalid_analysis',
          'Symbol exceeds the recorded file line count.',
        );
    });
    value.references.forEach((reference, index) => {
      if (
        reference.evidence.path !== value.path ||
        reference.evidence.sha256 !== value.sha256 ||
        reference.evidence.end_line > value.line_count ||
        reference.evidence.basis !== 'source'
      )
        issue(
          ctx,
          ['references', index],
          'invalid_analysis',
          'Reference evidence does not match the analyzed source.',
        );
    });
  });
export type FileAnalysis = z.infer<typeof FileAnalysisSchema>;
