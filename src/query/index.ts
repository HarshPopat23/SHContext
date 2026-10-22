import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeRepository } from '../core/analyze-repository.js';
import { scanRepository } from '../scanner/index.js';
import { readBounded, digest, decode } from '../scanner/filesystem.js';
import { sensitiveContent } from '../scanner/content.js';
import { verifyRepository } from '../validation/index.js';
import { readOwnedTree } from '../storage/publication.js';
import { contextPath, folderOf } from '../core/contracts/primitives.js';
import type { SourceSpan } from '../core/contracts/index.js';
import { terms, score, order, neighbors } from './search.js';
import type {
  QueryOptions,
  QueryResult,
  QueryMatch,
  QuerySummary,
} from './types.js';
export type {
  QueryOptions,
  QueryResult,
  QueryMatch,
  QuerySummary,
} from './types.js';

export class QueryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}
const splitLines = (text: string) => text.split(/\r\n|[\n\r\u2028\u2029]/u);
const safeDisplay = (text: string) =>
  text.replace(
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    '\uFFFD',
  );

/** Read-only lexical retrieval and conservative graph navigation; no model, embeddings or source execution. */
export function queryRepository(
  selectedRoot: string,
  question: string,
  options: QueryOptions = {},
): QueryResult {
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > 500 ||
    /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(question)
  )
    throw new QueryError(
      'query_configuration',
      'Supply a nonempty question of at most 500 characters without control characters.',
    );
  const limit = options.limit ?? 8,
    depth = options.depth ?? 1;
  if (
    Object.keys(options).some((key) => !['limit', 'depth'].includes(key)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    !Number.isInteger(depth) ||
    depth < 0 ||
    depth > 3
  )
    throw new QueryError(
      'query_configuration',
      'Query limit must be 1–20 and dependency depth 0–3.',
    );
  const context = verifyRepository(selectedRoot);
  const scan = scanRepository(selectedRoot);
  const report = analyzeRepository(selectedRoot, {
    expectedInputId: scan.inventory.input_id,
  });
  const root = realpathSync(selectedRoot);
  const wanted = terms(question);
  let snapshot: ReturnType<typeof readOwnedTree> = null;
  if (context.state !== 'invalid') {
    try {
      snapshot = readOwnedTree(root);
    } catch {
      throw new QueryError(
        'context_changed',
        'Context changed during retrieval; retry against a stable tree.',
      );
    }
  }
  const summaryText = new Map<string, string>();
  const summaryPaths = new Set<string>();
  for (const folder of snapshot?.manifest.directories ?? []) {
    const cached = snapshot?.cache?.folders.find(
      (item) => item.summary.source_path === folder.path,
    )?.summary;
    if (cached) {
      const evidencePaths = new Map(
        cached.evidence.map((item) => [item.id, item.path]),
      );
      for (const claim of [
        ...cached.purpose,
        ...cached.feature_flows,
        ...cached.files.flatMap((file) => file.claims),
      ])
        if (score(`${claim.text} ${claim.rationale ?? ''}`, wanted))
          for (const id of claim.evidence_ids) {
            const path = evidencePaths.get(id);
            if (path) summaryPaths.add(path);
          }
    }
    summaryText.set(
      folder.path,
      cached
        ? [
            ...cached.purpose,
            ...cached.feature_flows,
            ...cached.files.flatMap((file) => file.claims),
          ]
            .map(
              (item) =>
                `${item.kind === 'inference' ? 'Inference' : 'Observed'}: ${item.text}${item.rationale ? ` Rationale: ${item.rationale}` : ''}`,
            )
            .join(' ')
        : snapshot!.summaries.get(contextPath(folder.path))!,
    );
  }
  const bodies = new Map<string, string>();
  const candidates: QueryMatch[] = [];
  for (const entry of scan.inventory.entries) {
    if (entry.kind !== 'file' || entry.disposition === 'ignored') continue;
    const analysis = report.analyses.find((item) => item.path === entry.path);
    let body = '';
    if (entry.disposition === 'analyzed') {
      try {
        const read = readBounded(
          root,
          join(root, entry.path),
          scan.configuration.maxFileBytes,
        );
        if (read.oversized || digest(read.bytes) !== entry.sha256)
          throw new Error();
        body = decode(read.bytes, true);
        if (sensitiveContent(body)) throw new Error();
        bodies.set(entry.path, body);
      } catch {
        throw new QueryError(
          'source_changed',
          'An eligible source changed before retrieval; no source excerpts were returned.',
        );
      }
    }
    const symbols =
      analysis?.symbols
        .filter(
          (item) =>
            item.name &&
            item.name.length <= 200 &&
            (score(item.name, wanted) ||
              item.name.toLowerCase() === question.toLowerCase()),
        )
        .slice(0, 8) ?? [];
    const pathScore =
      score(entry.path, wanted) +
      Number(entry.path.toLowerCase() === question.toLowerCase()) * 4;
    const textScore = score(body, wanted);
    const summaryScore =
      entry.disposition !== 'analyzed'
        ? 0
        : snapshot?.cache
          ? Number(summaryPaths.has(entry.path))
          : score(summaryText.get(folderOf(entry.path)) ?? '', wanted);
    const reasons: QueryMatch['reasons'] = [];
    if (pathScore) reasons.push('path');
    if (symbols.length) reasons.push('symbol');
    if (textScore) reasons.push('text');
    if (summaryScore) reasons.push('summary');
    candidates.push({
      path: entry.path,
      score:
        pathScore * 20 +
        symbols.length * 15 +
        textScore * 3 +
        Number(summaryScore > 0),
      reasons,
      disposition: entry.disposition,
      inspection:
        entry.disposition !== 'analyzed'
          ? 'inventory-only'
          : entry.mode === 'structural'
            ? 'source'
            : entry.mode === 'configuration'
              ? 'configuration'
              : 'documentation',
      symbols,
      references: [],
      excerpt: '',
      excerpt_truncated: false,
    });
  }
  const ranked = candidates.filter((item) => item.score > 0).sort(order);
  // Reserve space for dependency neighbors without displacing the best lexical answer.
  const seedCount = depth
    ? Math.min(ranked.length, Math.max(1, Math.ceil(limit / 2)))
    : limit;
  const seeds = ranked.slice(0, seedCount);
  const graph = neighbors(
    seeds.map((item) => item.path),
    report.edges,
    depth,
    Math.max(0, limit - seeds.length),
  );
  const selected = new Map(seeds.map((item) => [item.path, item]));
  for (const path of graph.paths) {
    const item = candidates.find((candidate) => candidate.path === path);
    if (item) {
      selected.set(path, {
        ...item,
        reasons: [...new Set([...item.reasons, 'dependency' as const])],
      });
    }
  }
  for (const item of ranked)
    if (selected.size < limit)
      selected.set(item.path, selected.get(item.path) ?? item);
  const matches = [...selected.values()].sort(order);
  for (const item of matches) {
    const text = bodies.get(item.path),
      analysis = report.analyses.find(
        (analysis) => analysis.path === item.path,
      );
    if (!text || !analysis) continue;
    const lines = splitLines(text);
    const first =
      item.symbols[0]?.range.start_line ??
      Math.max(1, lines.findIndex((line) => score(line, wanted) > 0) + 1);
    const start = Math.max(1, first - 1),
      end = Math.min(lines.length, start + 9);
    const snippet = lines
      .slice(start - 1, end)
      .map((line, index) => `${start + index}: ${line}`)
      .join('\n');
    item.excerpt = safeDisplay(snippet.slice(0, 1200));
    item.excerpt_truncated =
      start > 1 || end < lines.length || snippet.length > 1200;
    const reference: SourceSpan = {
      path: item.path,
      sha256: analysis.sha256,
      start_line: start,
      end_line: end,
      symbol: item.symbols[0]?.name ?? null,
      basis:
        item.inspection === 'source'
          ? 'source'
          : item.inspection === 'configuration'
            ? 'configuration'
            : 'documentation',
    };
    item.references = [reference];
  }
  const selectedPaths = new Set(matches.map((item) => item.path));
  const allEdges = report.edges.filter(
    (edge) =>
      selectedPaths.has(edge.from) ||
      (edge.resolution === 'resolved' && selectedPaths.has(edge.to)),
  );
  const relationships = allEdges.slice(0, 64);
  const folderPaths = [...new Set(matches.map((item) => folderOf(item.path)))];
  const summaries: QuerySummary[] = folderPaths
    .filter((path) => summaryText.has(path))
    .slice(0, limit)
    .map((path) => {
      const cached = snapshot?.cache?.folders.find(
        (item) => item.summary.source_path === path,
      )?.summary;
      return {
        source_path: path,
        path: contextPath(path),
        freshness: context.state,
        excerpt: safeDisplay(summaryText.get(path)!.slice(0, 1200)),
        references:
          cached?.evidence.map(({ id: _id, ...span }) => span).slice(0, 20) ??
          [],
      };
    });
  const missing = context.findings.some(
    (finding) => finding.code === 'output_missing',
  );
  const status: QueryResult['status'] =
    context.state === 'fresh'
      ? matches.length
        ? 'answered'
        : 'no_match'
      : context.state === 'invalid'
        ? missing
          ? 'context_missing'
          : 'context_invalid'
        : context.state === 'stale'
          ? 'context_stale'
          : 'context_unknown';
  const limitations = [
    'Lexical matches and declared symbols identify candidates; they do not establish runtime behavior or a complete call graph.',
    'Generated summaries are navigation aids. Matching source hashes and model review do not prove explanation accuracy.',
    ...(context.state !== 'fresh'
      ? [
          `Generated context is ${missing ? 'missing; run shcontext build' : context.state + '; inspect or update it'}. Source matches below come from the current local scan, not a freshness claim about old summaries.`,
        ]
      : []),
    ...(scan.inventory.coverage === 'partial'
      ? [
          'Current source coverage is partial; unsupported, excluded or unreadable behavior is not established.',
        ]
      : []),
    ...(snapshot && !snapshot.cache
      ? [
          'Legacy Markdown summaries are searchable; update to preserve structured claims.',
        ]
      : []),
    ...(matches.some((item) => item.excerpt_truncated)
      ? [
          'Source excerpts are bounded; inspect the full cited file before concluding how it behaves.',
        ]
      : []),
    ...(graph.truncated || allEdges.length > 64
      ? ['Dependency traversal or relationship output reached its bound.']
      : []),
  ];
  const heading = matches.length
    ? 'Relevant current-source candidates:'
    : 'No matching eligible source was found. This does not establish that the feature is absent.';
  const answer = [
    context.state !== 'fresh'
      ? limitations.find((text) => text.startsWith('Generated context is'))
      : '',
    heading,
    ...matches.map(
      (item) =>
        `${item.path}${item.references[0] ? `:${item.references[0].start_line}–${item.references[0].end_line}` : ''} — ${item.symbols.length ? item.symbols.map((symbol) => `${symbol.kind} ${symbol.name}`).join(', ') : item.inspection === 'inventory-only' ? `inventory only (${item.disposition}); behavior not analyzed` : `${item.inspection} inspected`} [${item.reasons.join(', ')}]${item.excerpt ? '\n' + item.excerpt : ''}`,
    ),
    ...summaries
      .filter((item) => item.freshness === 'fresh')
      .map(
        (item) =>
          `Generated summary ${item.path} (review against source): ${item.excerpt}`,
      ),
    relationships.length
      ? 'Declared references (resolved file links do not imply calls):'
      : '',
    ...relationships.map(
      (edge) =>
        `${edge.from}: ${edge.reference.specifier ?? '[computed]'} → ${edge.resolution === 'resolved' ? edge.to : `${edge.resolution} (${edge.reason}); no confirmed file target`}`,
    ),
    ...limitations,
  ]
    .filter(Boolean)
    .join('\n\n');
  if (scanRepository(root).inventory.input_id !== scan.inventory.input_id)
    throw new QueryError(
      'source_changed',
      'Selected inputs changed during retrieval; retry against a stable tree.',
    );
  const end = verifyRepository(root);
  if (
    JSON.stringify(end) !== JSON.stringify(context) ||
    (snapshot && readOwnedTree(root)?.identity !== snapshot.identity)
  )
    throw new QueryError(
      'context_changed',
      'Context or freshness changed during retrieval; no stable answer was returned.',
    );
  return {
    schema_version: 1,
    question,
    input_id: scan.inventory.input_id,
    status,
    context,
    answer: safeDisplay(answer),
    matches,
    summaries,
    relationships,
    traversal: { depth, truncated: graph.truncated || allEdges.length > 64 },
    limitations,
  };
}
