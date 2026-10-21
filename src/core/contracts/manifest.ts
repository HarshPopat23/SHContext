import { z } from 'zod';
import {
  CoverageSchema,
  DiagnosticSchema,
  DirectoryEntryPathSchema,
  DispositionSchema,
  EffectiveConfigSchema,
  FilePathSchema,
  FolderPathSchema,
  HashSchema,
  ModeSchema,
  ProviderIdentitySchema,
  RelativePathSchema,
  SchemaVersionSchema,
  TextSchema,
  contextPath,
  issue,
  orderedUnique,
} from './primitives.js';
import { ReasonSchema } from './inventory.js';

export const GenerationIdentitySchema = z.strictObject({
  provider: ProviderIdentitySchema,
  generator: TextSchema,
  parser: TextSchema,
  resolver: TextSchema,
  prompt: TextSchema,
  template: TextSchema,
  renderer: TextSchema,
  detector: TextSchema,
  default_policy: TextSchema,
});
export const ManifestFileSchema = z
  .strictObject({
    path: FilePathSchema,
    sha256: HashSchema.nullable(),
    disposition: DispositionSchema,
    reason: ReasonSchema,
    mode: ModeSchema,
  })
  .superRefine((file, ctx) => {
    const readable = ['analyzed', 'inventory-only', 'parse-error'].includes(
      file.disposition,
    );
    const expectedMode =
      file.disposition === 'inventory-only'
        ? 'inventory-only'
        : file.disposition === 'parse-error'
          ? 'structural'
          : file.reason === 'supported_source'
            ? 'structural'
            : file.reason === 'supported_text'
              ? 'text'
              : file.reason === 'supported_configuration'
                ? 'configuration'
                : 'none';
    const reasons: Record<string, string[]> = {
      analyzed: [
        'supported_source',
        'supported_text',
        'supported_configuration',
      ],
      'inventory-only': ['unsupported_language'],
      'parse-error': ['syntax_error', 'parser_failed'],
      unreadable: ['permission_denied', 'read_failed'],
      skipped: ['too_large', 'sensitive_content'],
    };
    if (
      !reasons[file.disposition]?.includes(file.reason) ||
      file.mode !== expectedMode ||
      (readable ? file.sha256 === null : file.sha256 !== null)
    )
      issue(
        ctx,
        [],
        'invalid_manifest',
        'Manifest file must preserve a valid selected-text or failure identity.',
      );
  });
export const AnalysisFailureSchema = z.strictObject({
  path: z.union([FilePathSchema, DirectoryEntryPathSchema]),
  code: z.enum([
    'unsupported_language',
    'permission_denied',
    'read_failed',
    'directory_unreadable',
    'syntax_error',
    'parser_failed',
    'too_large',
    'sensitive_content',
  ]),
  message: TextSchema,
});
export type AnalysisFailure = z.infer<typeof AnalysisFailureSchema>;
const ControlPathSchema = FilePathSchema.refine(
  (path) =>
    path === 'shcontext.config.json' ||
    path === '.shcontextignore' ||
    path === '.gitignore' ||
    path.endsWith('/.gitignore'),
  'Expected a selection-control file.',
);
export const OutputPathSchema = RelativePathSchema.refine((path) => {
  if (
    path === 'context/.shcontext/report.json' ||
    path === 'context/CONTEXT.md'
  )
    return true;
  return (
    path.startsWith('context/') &&
    path.endsWith('/CONTEXT.md') &&
    FolderPathSchema.safeParse(path.slice(8, -11)).success
  );
}, 'Expected an owned context summary or portable report.');

export const GenerationManifestSchema = z
  .strictObject({
    schema_version: SchemaVersionSchema,
    generator: z.strictObject({
      version: TextSchema,
      generation_id: HashSchema,
    }),
    generation: GenerationIdentitySchema,
    selection: z.strictObject({
      configuration: EffectiveConfigSchema,
      control_files: z.array(
        z.strictObject({
          path: ControlPathSchema,
          sha256: HashSchema.nullable(),
        }),
      ),
    }),
    input_id: HashSchema,
    coverage: CoverageSchema,
    provenance: z.strictObject({
      git_head: z
        .string()
        .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
        .nullable(),
    }),
    files: z.array(ManifestFileSchema),
    directories: z
      .array(
        z.strictObject({ path: FolderPathSchema, coverage: CoverageSchema }),
      )
      .min(1),
    outputs: z
      .array(z.strictObject({ path: OutputPathSchema, sha256: HashSchema }))
      .min(2),
    analysis_failures: z.array(AnalysisFailureSchema),
    diagnostics: z.array(DiagnosticSchema),
  })
  .superRefine((value, ctx) => {
    for (const field of [
      'files',
      'directories',
      'outputs',
      'analysis_failures',
    ] as const)
      orderedUnique(
        value[field].map((entry) => entry.path),
        ctx,
        [field],
      );
    orderedUnique(
      value.selection.control_files.map((entry) => entry.path),
      ctx,
      ['selection', 'control_files'],
    );
    for (const path of [
      '.gitignore',
      '.shcontextignore',
      'shcontext.config.json',
    ])
      if (!value.selection.control_files.some((entry) => entry.path === path))
        issue(
          ctx,
          ['selection', 'control_files'],
          'invalid_manifest',
          'Root selection-control identities are required, including absent files as null.',
        );
    if (value.generator.version !== value.generation.generator)
      issue(
        ctx,
        ['generation', 'generator'],
        'invalid_manifest',
        'Generator version identifiers disagree.',
      );
    if (
      value.selection.configuration.provider?.id !==
        value.generation.provider.id ||
      value.selection.configuration.provider.model !==
        value.generation.provider.model
    )
      issue(
        ctx,
        ['generation', 'provider'],
        'invalid_manifest',
        'Provider/model identity does not match effective configuration.',
      );
    const root = value.directories.find((directory) => directory.path === '.');
    if (!root || root.coverage !== value.coverage)
      issue(
        ctx,
        ['directories'],
        'invalid_manifest',
        'Manifest needs a root directory with matching coverage.',
      );
    if ((value.coverage === 'partial') !== value.analysis_failures.length > 0)
      issue(
        ctx,
        ['analysis_failures'],
        'invalid_manifest',
        'Partial coverage and recorded analysis failures must agree.',
      );
    const expectedOutputs = [
      ...value.directories.map((directory) => contextPath(directory.path)),
      'context/.shcontext/report.json',
    ];
    const actual = new Set(value.outputs.map((entry) => entry.path));
    if (
      actual.size !== expectedOutputs.length ||
      expectedOutputs.some((path) => !actual.has(path))
    )
      issue(
        ctx,
        ['outputs'],
        'invalid_manifest',
        'Owned outputs must cover every folder and the report, excluding the manifest itself.',
      );
    const folded = value.outputs.map((entry) => entry.path.toLowerCase());
    if (new Set(folded).size !== folded.length)
      issue(
        ctx,
        ['outputs'],
        'duplicate_identity',
        'Owned paths collide after case folding.',
      );
  });
export type GenerationManifest = z.infer<typeof GenerationManifestSchema>;
