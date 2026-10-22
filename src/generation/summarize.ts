import { join } from 'node:path';
import { analyzeRepository } from '../core/analyze-repository.js';
import { scanRepository, type ScanResult } from '../scanner/index.js';
import {
  readBounded,
  digest,
  decode,
  byteOrder,
} from '../scanner/filesystem.js';
import { sensitiveContent } from '../scanner/content.js';
import {
  FolderSummarySchema,
  countInventory,
  includedFolder,
  isPartial,
  type FolderSummary,
  type SupportingEvidence,
  type SupportedClaim,
  type RepositoryAnalysis,
} from '../core/contracts/index.js';
import { contextPath, folderOf } from '../core/contracts/primitives.js';
import type { ModelProvider, CancellationSignal } from '../providers/index.js';
import {
  INSTRUCTIONS,
  DRAFT_JSON_SCHEMA,
  PROMPT_VERSION,
  checkedDraft,
  asClaim,
} from './draft.js';
import { BuildError } from './errors.js';

export const GENERATOR_VERSION = 'context-pipeline-v2';
export const RENDERER_VERSION = 'markdown-v1';
export const TEMPLATE_VERSION = 'context-sections-v1';
export function generationIdentity(
  scan: ScanResult,
  report: RepositoryAnalysis,
) {
  if (!scan.configuration.provider)
    throw new BuildError(
      'provider_configuration',
      'Set provider id and model in shcontext.config.json before building.',
    );
  return {
    provider: scan.configuration.provider,
    generator: GENERATOR_VERSION,
    parser: report.components.parser,
    resolver: report.components.resolver,
    prompt: PROMPT_VERSION,
    template: TEMPLATE_VERSION,
    renderer: RENDERER_VERSION,
    detector: scan.versions.detector,
    default_policy: scan.versions.default_policy,
  };
}
export function generationId(
  value: ReturnType<typeof generationIdentity>,
): string {
  const { provider, ...components } = value;
  const tuples = Object.entries({
    ...components,
    schema: '1',
    provider: provider.id,
    model: provider.model,
  }).sort(([a], [b]) => byteOrder(a, b));
  return digest(JSON.stringify(['generation-v1', tuples]));
}
const observed = (text: string, evidence_ids: string[]): SupportedClaim => ({
  kind: 'observed',
  text,
  evidence_ids,
  rationale: null,
});
export function under(path: string, folder: string): boolean {
  return (
    folder === '.' || path === `${folder}/` || path.startsWith(`${folder}/`)
  );
}
export function throwIfCancelled(signal?: CancellationSignal): void {
  if (signal?.aborted) throw new BuildError('cancelled', 'Build cancelled.');
}

/** Checked bytes stay in memory only; unsupported and failed contents never enter model input. */
export async function summarize(
  root: string,
  scan: ScanResult,
  provider: ModelProvider,
  signal?: CancellationSignal,
) {
  throwIfCancelled(signal);
  const report = analyzeRepository(root, {
    expectedInputId: scan.inventory.input_id,
  });
  const generation = generationIdentity(scan, report),
    id = generationId(generation);
  const sources = new Map<string, string>();
  const allEvidence = new Map<string, SupportingEvidence>();
  for (const analysis of report.analyses) {
    if (analysis.disposition !== 'analyzed') continue;
    try {
      const read = readBounded(
        root,
        join(root, analysis.path),
        scan.configuration.maxFileBytes,
      );
      if (read.oversized || digest(read.bytes) !== analysis.sha256)
        throw new Error();
      const text = decode(read.bytes, true);
      if (sensitiveContent(text)) throw new Error();
      if (analysis.line_count > 0) sources.set(analysis.path, text);
    } catch {
      throw new BuildError(
        'source_changed',
        'A selected source changed before evidence collection.',
      );
    }
    if (analysis.line_count === 0) continue;
    allEvidence.set(analysis.path, {
      id: `E${allEvidence.size + 1}`,
      path: analysis.path,
      sha256: analysis.sha256,
      start_line: 1,
      end_line: analysis.line_count,
      symbol: null,
      basis:
        analysis.mode === 'structural'
          ? 'source'
          : analysis.mode === 'configuration'
            ? 'configuration'
            : 'documentation',
    });
  }
  const paths = scan.inventory.entries.flatMap((entry) => {
    const path = includedFolder(entry);
    return path === null ? [] : [path];
  });
  const folders = new Map<string, FolderSummary>();
  // Descendants precede ancestors; siblings have deterministic UTF-8 ordering.
  paths.sort(
    (a, b) =>
      (b === '.' ? 0 : b.split('/').length) -
        (a === '.' ? 0 : a.split('/').length) || byteOrder(a, b),
  );
  for (const path of paths) {
    throwIfCancelled(signal);
    const entries = scan.inventory.entries.filter((entry) =>
      under(entry.path, path),
    );
    const children = [...folders.values()].filter(
      (child) => folderOf(child.source_path) === path,
    );
    const files = scan.inventory.entries.filter(
      (entry) =>
        entry.kind === 'file' &&
        entry.disposition !== 'ignored' &&
        folderOf(entry.path) === path,
    );
    const evidence = new Map<string, SupportingEvidence>();
    const addEvidence = (sourcePath: string) => {
      const item = allEvidence.get(sourcePath);
      if (item) evidence.set(item.id, item);
      return item?.id;
    };
    files.forEach((file) => addEvidence(file.path));
    children.forEach((child) =>
      child.evidence.forEach((item) => evidence.set(item.id, item)),
    );
    const base: FolderSummary = {
      schema_version: 1,
      source_path: path,
      coverage: entries.some(isPartial) ? 'partial' : 'complete',
      counts: countInventory(entries),
      input_id: scan.inventory.input_id,
      generation_id: id,
      purpose: [],
      files: files.map((file) => ({
        path: file.path,
        disposition: file.disposition,
        mode: file.mode,
        claims: [],
        limitations:
          file.disposition === 'analyzed'
            ? file.bytes === 0
              ? ['Empty file; no behavioral evidence.']
              : []
            : [`${file.disposition}: ${file.reason}; behavior not analyzed.`],
      })),
      interfaces_and_entry_points: [],
      dependencies_and_consumers: [],
      feature_flows: [],
      tests: [],
      children: children
        .map((child) => ({ path: child.source_path, coverage: child.coverage }))
        .sort((a, b) => byteOrder(a.path, b.path)),
      limitations: [
        'Mechanical citation checks do not establish semantic truth. Review explanations against source.',
        'Static file references are not a complete call graph. Tests were not executed.',
        ...(entries.some(isPartial)
          ? [
              'Partial coverage: unsupported, unreadable, oversized, sensitive or invalid source remains unanalyzed; see the inventory report.',
            ]
          : []),
      ],
      evidence: [],
    };
    // Interfaces are observed declaration facts. They do not assert runtime availability.
    for (const module of report.modules.filter(
      (module) => folderOf(module.path) === path,
    )) {
      const ref = addEvidence(module.path)!;
      for (const item of module.exports)
        base.interfaces_and_entry_points.push(
          observed(`${module.path} declares export ${item.name}.`, [ref]),
        );
    }
    for (const entry of report.entry_points.filter(
      (item) => folderOf(item.evidence.path) === path,
    )) {
      base.interfaces_and_entry_points.push(
        observed(
          `${entry.evidence.path} declares ${entry.kind} ${entry.selector}: ${entry.specifier}; ${entry.resolution === 'resolved' ? `file target ${entry.to}` : `unresolved (${entry.reason})`}. Active runtime selection is not established.`,
          [addEvidence(entry.evidence.path)!],
        ),
      );
    }
    // Include outgoing references and incoming cross-folder consumers, with no guessed targets.
    const edges = report.edges.filter(
      (edge) =>
        under(edge.from, path) ||
        (edge.resolution === 'resolved' && under(edge.to, path)),
    );
    for (const edge of edges) {
      const reference = addEvidence(edge.from)!;
      const target =
        edge.resolution === 'resolved'
          ? `resolved file ${edge.to} (${folderOf(edge.from) === folderOf(edge.to) ? 'same folder' : 'cross-folder reference'}; behavior and runtime execution are not implied)`
          : edge.resolution === 'external'
            ? `external reference (${edge.reason}; installation is not established)`
            : `unresolved (${edge.reason}); no target relationship established`;
      base.dependencies_and_consumers.push(
        observed(
          `${edge.from}: ${edge.reference.kind} ${edge.reference.specifier === null ? '[computed expression]' : JSON.stringify(edge.reference.specifier)} — ${target}.`,
          [reference],
        ),
      );
    }
    const available = [...evidence.values()].sort(
      (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
    );
    const directSources = files
      .filter((file) => sources.has(file.path))
      .map((file) => ({
        evidence_id: allEvidence.get(file.path)!.id,
        path: file.path,
        mode: file.mode,
        content: sources.get(file.path)!,
      }));
    // A parent can synthesize inspected child evidence; an entirely unanalyzable subtree needs no model.
    if (
      directSources.length ||
      children.some((child) => child.purpose.length)
    ) {
      const wordLimit =
        path === '.'
          ? scan.configuration.rootWordLimit
          : scan.configuration.folderWordLimit;
      const input = JSON.stringify({
        source_path: path,
        narrative_word_limit: wordLimit,
        files: base.files.map(({ path, disposition, mode, limitations }) => ({
          path,
          disposition,
          mode,
          limitations,
        })),
        sources: directSources,
        children,
        evidence: available,
        interfaces: base.interfaces_and_entry_points,
        dependencies: base.dependencies_and_consumers,
      });
      let draft: ReturnType<typeof checkedDraft> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        throwIfCancelled(signal);
        const raw = await provider.generate({
          instructions: INSTRUCTIONS,
          input: attempt
            ? `${input}\nThe preceding response failed local validation. Return a complete replacement using only supplied evidence and exact direct-file coverage, within the word limit.`
            : input,
          schema: DRAFT_JSON_SCHEMA,
          ...(signal ? { signal } : {}),
        });
        try {
          draft = checkedDraft(raw, base, available, wordLimit);
          break;
        } catch (error) {
          if (attempt || !(error instanceof BuildError)) throw error;
        }
      }
      if (!draft)
        throw new BuildError(
          'invalid_draft',
          'No validated folder draft was returned.',
        );
      base.purpose = draft.purpose.map(asClaim);
      base.feature_flows = draft.feature_flows.map(asClaim);
      for (const file of draft.files)
        base.files.find((item) => item.path === file.path)!.claims =
          file.claims.map(asClaim);
      base.tests = draft.tests.map((item) => ({
        ...item,
        execution: 'not-run',
      }));
      base.limitations.push(...draft.uncertainty);
    } else
      base.limitations.push(
        'No analyzable evidence establishes this folder’s purpose or behavior.',
      );
    const used = new Set(
      [
        ...base.purpose,
        ...base.files.flatMap((file) => file.claims),
        ...base.interfaces_and_entry_points,
        ...base.dependencies_and_consumers,
        ...base.feature_flows,
        ...base.tests,
      ].flatMap((claim) => claim.evidence_ids),
    );
    base.evidence = available.filter((item) => used.has(item.id));
    folders.set(path, FolderSummarySchema.parse(base));
  }
  if (scanRepository(root).inventory.input_id !== scan.inventory.input_id)
    throw new BuildError(
      'source_changed',
      'Selected inputs changed during generation; previous context was retained.',
    );
  return {
    report,
    folders: [...folders.values()].sort((a, b) =>
      byteOrder(a.source_path, b.source_path),
    ),
    generation,
    generation_id: id,
  };
}
export { contextPath };
