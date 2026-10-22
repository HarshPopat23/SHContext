import { realpathSync, lstatSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { scanRepository, ScanError } from '../scanner/index.js';
import {
  readBounded,
  digest,
  decode,
  byteOrder,
} from '../scanner/filesystem.js';
import {
  RepositoryAnalysisSchema,
  needsFileAnalysis,
  type RepositoryAnalysis,
  type FileAnalysis,
} from './contracts/index.js';
import { extractJavaScript } from '../parsers/javascript.js';
import { locations } from '../parsers/locations.js';
import {
  inspectConfiguration,
  type EntryDeclaration,
} from '../parsers/configuration.js';
import { STRUCTURE_PARSER_VERSION } from '../parsers/syntax.js';
import {
  buildDependencies,
  matchEntryPoints,
  RESOLVER_VERSION,
} from '../graph/index.js';
export interface AnalysisOptions {
  expectedInputId?: string;
}
/** Analyze current selected bytes, never execute source/configuration or contact models. */
export function analyzeRepository(
  selectedRoot: string,
  options: AnalysisOptions = {},
): RepositoryAnalysis {
  const scan = scanRepository(selectedRoot);
  if (
    options.expectedInputId !== undefined &&
    options.expectedInputId !== scan.inventory.input_id
  )
    throw new ScanError(
      'source_changed',
      'Selected inputs differ from the expected scan.',
    );
  const requested = resolve(selectedRoot);
  if (lstatSync(requested).isSymbolicLink())
    throw new ScanError('source_changed', 'Selected root became a symlink.');
  const root = realpathSync(requested);
  const report: RepositoryAnalysis = {
    schema_version: 1,
    inventory: scan.inventory,
    components: {
      parser: STRUCTURE_PARSER_VERSION,
      resolver: RESOLVER_VERSION,
    },
    analyses: [],
    modules: [],
    edges: [],
    configuration: [],
    entry_points: [],
    diagnostics: [],
  };
  const declarations: EntryDeclaration[] = [];
  for (const entry of scan.inventory.entries.filter(needsFileAnalysis)) {
    let text: string;
    try {
      const read = readBounded(
        root,
        join(root, entry.path),
        scan.configuration.maxFileBytes,
      );
      if (read.oversized || digest(read.bytes) !== entry.sha256)
        throw new Error();
      text = decode(read.bytes, true);
    } catch {
      throw new ScanError(
        'source_changed',
        'A selected source cannot be read with its scanned identity.',
        entry.path,
      );
    }
    if (entry.mode === 'structural' && entry.disposition === 'analyzed') {
      try {
        const result = extractJavaScript(entry.path, entry.sha256!, text);
        report.analyses.push(result.analysis);
        report.modules.push(result.module);
      } catch {
        throw new ScanError(
          'extraction_failed',
          'Structural extraction failed; no incomplete analysis was returned.',
          entry.path,
        );
      }
    } else {
      const analysis: FileAnalysis = {
        schema_version: 1,
        path: entry.path,
        sha256: entry.sha256!,
        line_count: locations(entry.path, entry.sha256!, text).line_count,
        language:
          entry.mode === 'structural'
            ? /\.[cm]?tsx?$/i.test(entry.path)
              ? 'typescript'
              : 'javascript'
            : entry.mode === 'configuration'
              ? 'configuration'
              : entry.mode === 'text'
                ? 'text'
                : ({
                    '.py': 'python',
                    '.rs': 'rust',
                    '.go': 'go',
                    '.css': 'css',
                    '.html': 'html',
                  }[extname(entry.path).toLowerCase()] ?? 'unsupported'),
        mode: entry.mode as FileAnalysis['mode'],
        disposition: entry.disposition as FileAnalysis['disposition'],
        symbols: [],
        references: [],
        diagnostics: [...entry.diagnostics],
      };
      if (entry.mode === 'inventory-only')
        analysis.diagnostics.push({
          code: 'unsupported_language',
          message:
            'Inventory-only fallback: no symbols, behavior or dependencies were extracted.',
        });
      report.analyses.push(analysis);
    }
    if (entry.mode === 'configuration' && entry.disposition === 'analyzed') {
      const inspected = inspectConfiguration(entry.path, entry.sha256!, text);
      if (inspected) {
        report.configuration.push(inspected.record);
        declarations.push(...inspected.declarations);
      }
    }
  }
  report.analyses.sort((a, b) => byteOrder(a.path, b.path));
  report.modules.sort((a, b) => byteOrder(a.path, b.path));
  report.configuration.sort((a, b) => byteOrder(a.path, b.path));
  report.edges = buildDependencies(
    report.analyses,
    scan.inventory,
    report.configuration,
  );
  report.entry_points = matchEntryPoints(declarations, scan.inventory);
  if (scanRepository(root).inventory.input_id !== scan.inventory.input_id)
    throw new ScanError(
      'source_changed',
      'Selected inputs changed during extraction.',
    );
  return RepositoryAnalysisSchema.parse(report);
}
