import { z } from 'zod';
import { FileAnalysisSchema, DependencyEdgeSchema } from './analysis.js';
import { RepositoryInventorySchema, needsFileAnalysis } from './inventory.js';
import {
  DiagnosticSchema,
  FilePathSchema,
  HashSchema,
  SchemaVersionSchema,
  SourceSpanSchema,
  TextSchema,
  UIntSchema,
  issue,
  orderedUnique,
} from './primitives.js';

export const ImportBindingSchema = z.strictObject({
  kind: z.enum(['default', 'named', 'namespace', 'side-effect', 'require']),
  imported: z.string().nullable(),
  local: TextSchema.nullable(),
  type_only: z.boolean(),
  reference_start_byte: UIntSchema,
  evidence: SourceSpanSchema,
});
export const ExportBindingSchema = z.strictObject({
  name: z.string(),
  local: TextSchema.nullable(),
  kind: z.enum(['local', 'default', 're-export', 'commonjs']),
  type_only: z.boolean(),
  reference_start_byte: UIntSchema.nullable(),
  evidence: SourceSpanSchema,
});
export const ModuleStructureSchema = z.strictObject({
  path: FilePathSchema,
  sha256: HashSchema,
  imports: z.array(ImportBindingSchema),
  exports: z.array(ExportBindingSchema),
  diagnostics: z.array(DiagnosticSchema),
});
export type ModuleStructure = z.infer<typeof ModuleStructureSchema>;
export const ConfigurationRecordSchema = z.strictObject({
  path: FilePathSchema,
  sha256: HashSchema,
  format: z.enum(['package-json', 'typescript-jsonc']),
  facts: z.array(
    z.strictObject({
      pointer: z.string().startsWith('/'),
      kind: z.enum([
        'package-name',
        'package-type',
        'script-name',
        'dependency-name',
        'compiler-option',
        'path-alias',
        'compiler-extends',
        'project-reference',
      ]),
      value: z.union([z.string(), z.boolean(), z.array(z.string())]),
      evidence: SourceSpanSchema,
    }),
  ),
  diagnostics: z.array(DiagnosticSchema),
});
export type ConfigurationRecord = z.infer<typeof ConfigurationRecordSchema>;
export const EntryPointSchema = z
  .strictObject({
    kind: z.enum(['main', 'module', 'types', 'typings', 'bin', 'exports']),
    selector: z.string().startsWith('/'),
    specifier: z.string(),
    evidence: SourceSpanSchema,
    resolution: z.enum(['resolved', 'unresolved']),
    to: FilePathSchema.nullable(),
    reason: z
      .enum([
        'missing_target',
        'excluded_target',
        'outside_root',
        'unsupported_resolution',
        'pattern',
      ])
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.resolution === 'resolved') !==
        (value.to !== null && value.reason === null) ||
      (value.resolution === 'unresolved' &&
        (value.to !== null || value.reason === null))
    )
      issue(
        ctx,
        [],
        'invalid_dependency',
        'Entry-point resolution must have either a target or an explicit unresolved reason.',
      );
  });
export type EntryPoint = z.infer<typeof EntryPointSchema>;
/** Read-only analysis handoff, independent of future summaries/manifests. */
export const RepositoryAnalysisSchema = z
  .strictObject({
    schema_version: SchemaVersionSchema,
    inventory: RepositoryInventorySchema,
    components: z.strictObject({ parser: TextSchema, resolver: TextSchema }),
    analyses: z.array(FileAnalysisSchema),
    modules: z.array(ModuleStructureSchema),
    edges: z.array(DependencyEdgeSchema),
    configuration: z.array(ConfigurationRecordSchema),
    entry_points: z.array(EntryPointSchema),
    diagnostics: z.array(DiagnosticSchema),
  })
  .superRefine((report, ctx) => {
    const entries = new Map(report.inventory.entries.map((e) => [e.path, e])),
      analyses = new Map(report.analyses.map((a) => [a.path, a]));
    const bad = (path: (string | number)[], message: string) =>
      issue(ctx, path, 'inconsistent_bundle', message);
    const equal = (
      expected: string[],
      actual: string[],
      path: (string | number)[],
    ) => {
      const actualSet = new Set(actual);
      if (
        expected.length !== actual.length ||
        actualSet.size !== actual.length ||
        expected.some((p) => !actualSet.has(p))
      )
        bad(path, 'Collection must cover exactly the expected identities.');
    };
    for (const key of ['analyses', 'modules', 'configuration'] as const)
      orderedUnique(
        report[key].map((e) => e.path),
        ctx,
        [key],
      );
    equal(
      report.inventory.entries.filter(needsFileAnalysis).map((e) => e.path),
      report.analyses.map((a) => a.path),
      ['analyses'],
    );
    equal(
      report.analyses
        .filter((a) => a.mode === 'structural' && a.disposition === 'analyzed')
        .map((a) => a.path),
      report.modules.map((m) => m.path),
      ['modules'],
    );
    const evidence = (
      span: z.infer<typeof SourceSpanSchema>,
      where: (string | number)[],
    ) => {
      const a = analyses.get(span.path);
      if (
        !a ||
        a.disposition !== 'analyzed' ||
        a.mode === 'inventory-only' ||
        span.sha256 !== a.sha256 ||
        span.end_line > a.line_count ||
        span.basis !==
          (a.mode === 'structural'
            ? 'source'
            : a.mode === 'configuration'
              ? 'configuration'
              : 'documentation')
      )
        bad(
          where,
          'Evidence must match a successfully inspected file, mode, digest and range.',
        );
    };
    report.analyses.forEach((a, i) => {
      const e = entries.get(a.path);
      if (
        !e ||
        e.sha256 !== a.sha256 ||
        e.mode !== a.mode ||
        e.disposition !== a.disposition
      )
        bad(['analyses', i], 'File analysis must agree with inventory.');
      for (const r of a.references)
        if (e?.bytes === null || e?.bytes === undefined || r.end_byte > e.bytes)
          bad(
            ['analyses', i, 'references'],
            'Reference exceeds recorded byte length.',
          );
    });
    const refKey = (
      path: string,
      r: z.infer<typeof DependencyEdgeSchema>['reference'],
    ) =>
      JSON.stringify([
        path,
        r.kind,
        r.specifier,
        r.start_byte,
        r.end_byte,
        r.evidence.path,
        r.evidence.sha256,
        r.evidence.start_line,
        r.evidence.end_line,
        r.evidence.basis,
        r.evidence.symbol,
      ]);
    equal(
      report.analyses.flatMap((a) =>
        a.references.map((r) => refKey(a.path, r)),
      ),
      report.edges.map((e) => refKey(e.from, e.reference)),
      ['edges'],
    );
    const included = (path: string) => {
      const entry = entries.get(path);
      return (
        entry?.kind === 'file' &&
        ['analyzed', 'inventory-only', 'parse-error'].includes(
          entry.disposition,
        )
      );
    };
    report.edges.forEach((e, i) => {
      evidence(e.reference.evidence, ['edges', i]);
      if (e.resolution === 'resolved' && !included(e.to))
        bad(['edges', i, 'to'], 'Resolved target must be an included file.');
    });
    const offsets = new Map(
      report.analyses.map((a) => [
        a.path,
        new Set(a.references.map((r) => r.start_byte)),
      ]),
    );
    report.modules.forEach((m, i) => {
      const a = analyses.get(m.path);
      if (m.sha256 !== a?.sha256)
        bad(['modules', i], 'Module digest differs from file analysis.');
      for (const b of [...m.imports, ...m.exports]) {
        evidence(b.evidence, ['modules', i]);
        if (b.evidence.path !== m.path)
          bad(['modules', i], 'Module evidence must belong to that module.');
        if (
          b.reference_start_byte !== null &&
          !offsets.get(m.path)?.has(b.reference_start_byte)
        )
          bad(
            ['modules', i],
            'Binding reference must exist in its file analysis.',
          );
      }
    });
    const configurationName = (path: string) => path.split('/').at(-1)!;
    equal(
      report.analyses
        .filter(
          (a) =>
            a.mode === 'configuration' &&
            a.disposition === 'analyzed' &&
            (configurationName(a.path) === 'package.json' ||
              /^(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/i.test(
                configurationName(a.path),
              )),
        )
        .map((a) => a.path),
      report.configuration.map((c) => c.path),
      ['configuration'],
    );
    report.configuration.forEach((c, i) => {
      const a = analyses.get(c.path);
      if (
        !a ||
        c.sha256 !== a.sha256 ||
        a.mode !== 'configuration' ||
        c.format !==
          (configurationName(c.path) === 'package.json'
            ? 'package-json'
            : 'typescript-jsonc')
      )
        bad(
          ['configuration', i],
          'Configuration facts require matching inspected configuration.',
        );
      c.facts.forEach((f) => {
        evidence(f.evidence, ['configuration', i]);
        if (f.evidence.path !== c.path)
          bad(
            ['configuration', i],
            'Configuration evidence must belong to its file.',
          );
      });
    });
    report.entry_points.forEach((p, i) => {
      evidence(p.evidence, ['entry_points', i]);
      if (
        p.evidence.basis !== 'configuration' ||
        !report.configuration.some(
          (c) => c.path === p.evidence.path && c.format === 'package-json',
        )
      )
        bad(
          ['entry_points', i],
          'Entry point requires inspected package configuration.',
        );
      if (p.resolution === 'resolved' && !included(p.to!))
        bad(['entry_points', i], 'Entry point target must be included.');
    });
  });
export type RepositoryAnalysis = z.infer<typeof RepositoryAnalysisSchema>;
