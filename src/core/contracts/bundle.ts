import { z } from 'zod';
import { FileAnalysisSchema, DependencyEdgeSchema } from './analysis.js';
import type { FileAnalysis } from './analysis.js';
import { FolderSummarySchema } from './folder.js';
import {
  RepositoryInventorySchema,
  includedFolder,
  isPartial,
  needsFileAnalysis,
  needsManifestFile,
  countInventory,
} from './inventory.js';
import { GenerationManifestSchema } from './manifest.js';
import {
  SchemaVersionSchema,
  folderOf,
  issue,
  orderedUnique,
} from './primitives.js';
import type { SourceSpan } from './primitives.js';

/** A complete handoff snapshot, not a filesystem or freshness verification. */
export const ContractBundleSchema = z
  .strictObject({
    schema_version: SchemaVersionSchema,
    inventory: RepositoryInventorySchema,
    analyses: z.array(FileAnalysisSchema),
    edges: z.array(DependencyEdgeSchema),
    folders: z.array(FolderSummarySchema),
    manifest: GenerationManifestSchema,
  })
  .superRefine((bundle, ctx) => {
    const { inventory, manifest } = bundle;
    const entries = new Map(
      inventory.entries.map((entry) => [entry.path, entry]),
    );
    const analyses = new Map(
      bundle.analyses.map((analysis) => [analysis.path, analysis]),
    );
    const folders = new Map(
      bundle.folders.map((folder) => [folder.source_path, folder]),
    );
    orderedUnique(
      bundle.analyses.map((entry) => entry.path),
      ctx,
      ['analyses'],
    );
    orderedUnique(
      bundle.folders.map((entry) => entry.source_path),
      ctx,
      ['folders'],
    );
    const mismatch = (path: (string | number)[], message: string): void =>
      issue(ctx, path, 'inconsistent_bundle', message);
    const sameSet = (
      expected: string[],
      actual: string[],
      path: (string | number)[],
    ): void => {
      const set = new Set(actual);
      if (
        expected.length !== actual.length ||
        expected.some((item) => !set.has(item))
      )
        mismatch(
          path,
          'Collection does not cover the expected inventory identities.',
        );
    };
    if (
      manifest.input_id !== inventory.input_id ||
      manifest.coverage !== inventory.coverage
    )
      mismatch(
        ['manifest'],
        'Manifest identity or coverage differs from inventory.',
      );
    if (inventory.entries.length > manifest.selection.configuration.maxEntries)
      mismatch(
        ['inventory', 'entries'],
        'Inventory exceeds the configured entry budget.',
      );
    sameSet(
      inventory.entries.filter(needsFileAnalysis).map((entry) => entry.path),
      [...analyses.keys()],
      ['analyses'],
    );
    sameSet(
      inventory.entries.flatMap((entry) => {
        const path = includedFolder(entry);
        return path === null ? [] : [path];
      }),
      [...folders.keys()],
      ['folders'],
    );
    const checkEvidence = (
      evidence: SourceSpan,
      path: (string | number)[],
    ): void => {
      const analysis = analyses.get(evidence.path);
      const expectedBasis =
        analysis?.mode === 'structural'
          ? 'source'
          : analysis?.mode === 'configuration'
            ? 'configuration'
            : 'documentation';
      if (
        !analysis ||
        analysis.disposition !== 'analyzed' ||
        evidence.sha256 !== analysis.sha256 ||
        evidence.end_line > analysis.line_count ||
        evidence.basis !== expectedBasis
      )
        mismatch(
          path,
          'Evidence does not match an inspected source identity, mode or range.',
        );
    };
    bundle.analyses.forEach((analysis, index) => {
      const entry = entries.get(analysis.path);
      if (
        entry?.bytes !== null &&
        entry?.bytes !== undefined &&
        entry.bytes > manifest.selection.configuration.maxFileBytes
      )
        mismatch(
          ['analyses', index],
          'Analyzed text exceeds the configured file limit.',
        );
      if (
        !entry ||
        entry.sha256 !== analysis.sha256 ||
        entry.disposition !== analysis.disposition ||
        entry.mode !== analysis.mode
      )
        mismatch(['analyses', index], 'File analysis differs from inventory.');
      analysis.references.forEach((reference, referenceIndex) => {
        if (
          entry?.bytes === null ||
          entry?.bytes === undefined ||
          reference.end_byte > entry.bytes
        )
          mismatch(
            ['analyses', index, 'references', referenceIndex],
            'Reference byte range exceeds recorded source size.',
          );
      });
    });
    function referenceKey(
      analysis: Pick<FileAnalysis, 'path'>,
      reference: z.infer<typeof DependencyEdgeSchema>['reference'],
    ): string {
      return JSON.stringify([
        analysis.path,
        reference.kind,
        reference.specifier,
        reference.start_byte,
        reference.end_byte,
        reference.evidence.sha256,
        reference.evidence.start_line,
        reference.evidence.end_line,
        reference.evidence.symbol,
        reference.evidence.basis,
      ]);
    }
    const referenceKeys = bundle.analyses.flatMap((analysis) =>
      analysis.references.map((reference) => referenceKey(analysis, reference)),
    );
    const edgeKeys = bundle.edges.map((edge) =>
      referenceKey({ path: edge.from }, edge.reference),
    );
    if (
      new Set(referenceKeys).size !== referenceKeys.length ||
      new Set(edgeKeys).size !== edgeKeys.length
    )
      mismatch(
        ['edges'],
        'References and graph edges need unique source identities.',
      );
    sameSet(referenceKeys, edgeKeys, ['edges']);
    bundle.edges.forEach((edge, index) => {
      checkEvidence(edge.reference.evidence, [
        'edges',
        index,
        'reference',
        'evidence',
      ]);
      const target =
        edge.resolution === 'resolved' ? entries.get(edge.to) : null;
      if (
        edge.resolution === 'resolved' &&
        (!target ||
          target.kind !== 'file' ||
          !['analyzed', 'inventory-only', 'parse-error', 'unreadable'].includes(
            target.disposition,
          ))
      )
        mismatch(
          ['edges', index, 'to'],
          'Resolved edge target must be an included source candidate.',
        );
    });
    bundle.folders.forEach((folder, index) => {
      const underFolder = inventory.entries.filter(
        (entry) =>
          folder.source_path === '.' ||
          entry.path === `${folder.source_path}/` ||
          entry.path.startsWith(`${folder.source_path}/`),
      );
      const coverage = underFolder.some(isPartial) ? 'partial' : 'complete';
      const expectedCounts = countInventory(underFolder);
      for (const kind of ['files', 'directories'] as const)
        for (const disposition of Object.keys(
          expectedCounts[kind],
        ) as (keyof typeof expectedCounts.files)[])
          if (
            folder.counts[kind][disposition] !==
            expectedCounts[kind][disposition]
          )
            mismatch(
              ['folders', index, 'counts', kind, disposition],
              'Folder counts differ from its observed subtree.',
            );
      if (
        folder.coverage !== coverage ||
        folder.input_id !== inventory.input_id ||
        folder.generation_id !== manifest.generator.generation_id
      )
        mismatch(
          ['folders', index],
          'Folder identity or descendant coverage disagrees with its snapshot.',
        );
      const directFiles = inventory.entries.filter(
        (entry) =>
          entry.kind === 'file' &&
          entry.disposition !== 'ignored' &&
          folderOf(entry.path) === folder.source_path,
      );
      sameSet(
        directFiles.map((entry) => entry.path),
        folder.files.map((entry) => entry.path),
        ['folders', index, 'files'],
      );
      folder.files.forEach((file, fileIndex) => {
        const entry = entries.get(file.path);
        if (file.disposition !== entry?.disposition || file.mode !== entry.mode)
          mismatch(
            ['folders', index, 'files', fileIndex],
            'File summary mode/disposition differs from inventory.',
          );
      });
      const children = [...folders.values()].filter(
        (child) =>
          child.source_path !== '.' &&
          folderOf(child.source_path) === folder.source_path,
      );
      sameSet(
        children.map((child) => child.source_path),
        folder.children.map((child) => child.path),
        ['folders', index, 'children'],
      );
      folder.children.forEach((child, childIndex) => {
        if (child.coverage !== folders.get(child.path)?.coverage)
          mismatch(
            ['folders', index, 'children', childIndex],
            'Child coverage differs from the child summary.',
          );
      });
      folder.evidence.forEach((evidence, evidenceIndex) =>
        checkEvidence(evidence, ['folders', index, 'evidence', evidenceIndex]),
      );
    });
    sameSet(
      inventory.entries.filter(needsManifestFile).map((entry) => entry.path),
      manifest.files.map((file) => file.path),
      ['manifest', 'files'],
    );
    manifest.files.forEach((file, index) => {
      const entry = entries.get(file.path);
      if (
        !entry ||
        file.sha256 !== entry.sha256 ||
        file.disposition !== entry.disposition ||
        file.mode !== entry.mode ||
        file.reason !== entry.reason
      )
        mismatch(
          ['manifest', 'files', index],
          'Manifest file identity differs from inventory.',
        );
    });
    sameSet(
      [...folders.keys()],
      manifest.directories.map((directory) => directory.path),
      ['manifest', 'directories'],
    );
    manifest.directories.forEach((directory, index) => {
      if (directory.coverage !== folders.get(directory.path)?.coverage)
        mismatch(
          ['manifest', 'directories', index],
          'Manifest directory coverage differs from its summary.',
        );
    });
    const failures = inventory.entries.filter(isPartial);
    sameSet(
      failures.map((entry) => entry.path),
      manifest.analysis_failures.map((failure) => failure.path),
      ['manifest', 'analysis_failures'],
    );
    manifest.analysis_failures.forEach((failure, index) => {
      if (failure.code !== entries.get(failure.path)?.reason)
        mismatch(
          ['manifest', 'analysis_failures', index],
          'Manifest failure reason differs from inventory.',
        );
    });
    manifest.selection.control_files.forEach((control, index) => {
      const entry = entries.get(control.path);
      if (entry?.sha256 && control.sha256 !== entry.sha256)
        mismatch(
          ['manifest', 'selection', 'control_files', index],
          'Selection-control digest differs from the readable inventory identity.',
        );
    });
  });
export type ContractBundle = z.infer<typeof ContractBundleSchema>;
