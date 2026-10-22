import {
  escapeMarkdown as escape,
  relativeLink,
} from '../generation/render.js';
import { renderFolder } from '../generation/render.js';
import {
  SupportingEvidenceSchema,
  countInventory,
  type RepositoryInventory,
  type GenerationManifest,
  type SupportingEvidence,
  type FolderSummary,
} from '../core/contracts/index.js';
import { contextPath, folderOf } from '../core/contracts/primitives.js';

export class SummaryError extends Error {
  constructor() {
    super(
      'Summary violates the supported Markdown format, metadata, links, inventory or evidence contract.',
    );
  }
}
function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new SummaryError();
}
const empty = 'Not established from inspected evidence.';
const headings = [
  'Purpose',
  'Files and responsibilities',
  'Interfaces and entry points',
  'Dependencies and consumers',
  'Feature flows',
  'Tests',
  'Child folders',
  'Coverage and limitations',
  'Evidence',
];
/** Decode only the renderer's plain-text escaping, not arbitrary Markdown/HTML. */
function plain(value: string): string {
  const text = value
    .replace(/\\([\\`*_[\]{}()#+.!|~$-])/g, '$1')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
  requireValue(
    escape(text) === value && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text),
  );
  return text;
}
const paragraphs = (value: string) =>
  value === empty ? [] : value.split('\n\n');
const citationPattern = /\[(E[1-9][0-9]*)\]\(#(e[1-9][0-9]*)\)/g;
export interface SummaryInspection {
  source_path: string;
  evidence: SupportingEvidence[];
}

/** Validate the emitted v1 Markdown dialect; never evaluate general Markdown or YAML. */
export function inspectSummary(
  markdown: string,
  folder: GenerationManifest['directories'][number],
  manifest: GenerationManifest,
  inventory: RepositoryInventory,
): SummaryInspection {
  requireValue(!markdown.includes('\r') && markdown.endsWith('\n'));
  const document = contextPath(folder.path);
  const blocks = markdown.trimEnd().split(/\n\n(?=## )/);
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const header = [
    '---',
    'schema_version: 1',
    `source_path: ${quote(folder.path)}`,
    `coverage: ${quote(folder.coverage)}`,
    `input_id: ${quote(manifest.input_id)}`,
    `generation_id: ${quote(manifest.generator.generation_id)}`,
    '---',
    '',
    `# Context: ${escape(folder.path)}`,
  ].join('\n');
  requireValue(blocks.shift() === header && blocks.length === headings.length);
  const sections = blocks.map((block, index) => {
    const prefix = `## ${headings[index]}\n\n`;
    requireValue(block.startsWith(prefix));
    const body = block.slice(prefix.length).trimEnd();
    requireValue(body.length > 0);
    return body;
  });
  const evidence = new Map<string, SupportingEvidence>();
  const entries = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  const evidenceBlocks =
    sections[8] === empty ? [] : sections[8]!.split(/\n\n(?=### )/);
  for (const block of evidenceBlocks) {
    const match =
      /^### (E[1-9][0-9]*)\n\n\[(.*)\]\(([^\n]*)\) — lines ([0-9]+)–([0-9]+); basis: (source|configuration|documentation); symbol: (.*); SHA-256: `(sha256:[0-9a-f]{64})`\.$/.exec(
        block,
      );
    requireValue(match);
    const [, id, label, link, start, end, basis, symbol, sha256] = match!;
    const path = plain(label!);
    const parsed = SupportingEvidenceSchema.safeParse({
      id,
      path,
      sha256,
      start_line: Number(start),
      end_line: Number(end),
      basis,
      symbol: symbol === 'none' ? null : plain(symbol!),
    });
    requireValue(
      parsed.success &&
        !evidence.has(id!) &&
        link === relativeLink(document, path),
    );
    const entry = entries.get(path);
    requireValue(
      entry?.kind === 'file' &&
        entry.disposition === 'analyzed' &&
        entry.sha256 === sha256 &&
        basis ===
          (entry.mode === 'structural'
            ? 'source'
            : entry.mode === 'configuration'
              ? 'configuration'
              : 'documentation'),
    );
    evidence.set(id!, parsed.data);
  }
  const cited = (value: string, ownPath?: string, sequence = false): string => {
    const matches = [...value.matchAll(citationPattern)];
    requireValue(matches.length);
    for (const match of matches)
      requireValue(
        evidence.has(match[1]!) && match[2] === match[1]!.toLowerCase(),
      );
    // Each consecutive citation group is a claim's support, including file claims.
    const groups = value.match(
      /\[E[1-9][0-9]*\]\(#e[1-9][0-9]*\)(?: \[E[1-9][0-9]*\]\(#e[1-9][0-9]*\))*/g,
    )!;
    for (const group of groups) {
      const ids = [...group.matchAll(citationPattern)].map(
        (match) => match[1]!,
      );
      requireValue(
        new Set(ids).size === ids.length &&
          (ownPath === undefined ||
            ids.some((id) => evidence.get(id)!.path === ownPath)),
      );
    }
    if (!sequence) {
      const first = matches[0]!.index!;
      const last = matches.at(-1)!;
      const tail = value.slice(last.index! + last[0].length);
      requireValue(groups.length === 1 && first > 0);
      if (value.startsWith('**Inference:** '))
        requireValue(
          tail.startsWith(' Reasoning: ') && tail.slice(12).trim().length,
        );
      else requireValue(tail === '');
    } else {
      // File claims share a paragraph in renderer v1. Check every reference group
      // and all intervening text; semantic claim boundaries still require review.
      requireValue(matches[0]!.index! > 0);
      for (const marker of value.matchAll(/\*\*Inference:\*\* /g)) {
        const after = value.slice(marker.index! + marker[0].length);
        requireValue(
          /\[E[1-9][0-9]*\]\(#e[1-9][0-9]*\)(?: \[E[1-9][0-9]*\]\(#e[1-9][0-9]*\))* Reasoning: \S/.test(
            after,
          ),
        );
      }
      if (!value.includes('**Inference:** '))
        requireValue(value.endsWith(matches.at(-1)![0]));
    }
    const encoded = value
      .replace(citationPattern, '')
      .replaceAll('**Inference:** ', '')
      .replaceAll(' Reasoning: ', ' ');
    const text = plain(encoded).trim();
    requireValue(text.length > 0);
    return text;
  };
  const narrative: string[] = [];
  for (const index of [0, 2, 3, 4])
    for (const paragraph of paragraphs(sections[index]!)) {
      const text = cited(paragraph);
      if (index === 0 || index === 4) narrative.push(text);
    }
  const direct = inventory.entries.filter(
    (entry) =>
      entry.kind === 'file' &&
      entry.disposition !== 'ignored' &&
      folderOf(entry.path) === folder.path,
  );
  const fileParagraphs = paragraphs(sections[1]!);
  requireValue(fileParagraphs.length === direct.length);
  direct.forEach((file, index) => {
    const prefix = `- [${escape(file.path)}](${relativeLink(document, file.path)}) — ${file.mode}; ${file.disposition}. `;
    const paragraph = fileParagraphs[index]!;
    requireValue(paragraph.startsWith(prefix));
    const body = paragraph.slice(prefix.length);
    if (file.disposition !== 'analyzed')
      requireValue(
        body.trim() ===
          escape(`${file.disposition}: ${file.reason}; behavior not analyzed.`),
      );
    else if (file.bytes === 0)
      requireValue(
        body.trim() === escape('Empty file; no behavioral evidence.'),
      );
    else narrative.push(cited(body.trim(), file.path, true));
  });
  const tests = new Set<string>();
  for (const paragraph of paragraphs(sections[5]!)) {
    const match =
      /^- \[(.*)\]\(([^\n]*)\): (.*) Inspected only; not executed\.$/.exec(
        paragraph,
      );
    requireValue(match);
    const path = plain(match![1]!);
    const file = entries.get(path);
    requireValue(
      file?.kind === 'file' &&
        file.disposition === 'analyzed' &&
        !tests.has(path) &&
        match![2] === relativeLink(document, path),
    );
    tests.add(path);
    narrative.push(cited(match![3]!, path));
  }
  const children = manifest.directories.filter(
    (child) => child.path !== '.' && folderOf(child.path) === folder.path,
  );
  requireValue(
    JSON.stringify(paragraphs(sections[6]!)) ===
      JSON.stringify(
        children.map(
          (child) =>
            `- [${escape(child.path)}](${relativeLink(document, contextPath(child.path))}) — ${child.coverage}.`,
        ),
      ),
  );
  const subtree = inventory.entries.filter(
    (entry) =>
      folder.path === '.' ||
      entry.path === `${folder.path}/` ||
      entry.path.startsWith(`${folder.path}/`),
  );
  const base: FolderSummary = {
    schema_version: 1,
    source_path: folder.path,
    coverage: folder.coverage,
    counts: countInventory(subtree),
    input_id: manifest.input_id,
    generation_id: manifest.generator.generation_id,
    purpose: [],
    files: [],
    interfaces_and_entry_points: [],
    dependencies_and_consumers: [],
    feature_flows: [],
    tests: [],
    children: [],
    limitations: [],
    evidence: [],
  };
  const coverageExpected = renderFolder(base)
    .split('## Coverage and limitations\n\n')[1]!
    .split('\n\n## Evidence')[0]!;
  const coverage = paragraphs(sections[7]!);
  const expected = paragraphs(coverageExpected.trim());
  requireValue(
    coverage[0] === expected[0] &&
      coverage[1] === expected[1] &&
      coverage.at(-1) === expected.at(-1) &&
      coverage.length >= 4,
  );
  for (const paragraph of coverage.slice(2, -1)) {
    requireValue(paragraph.startsWith('- '));
    requireValue(plain(paragraph.slice(2)).trim().length > 0);
  }
  // The first two limits, plus the conditional partial/no-evidence notices, are
  // deterministic generation metadata, outside the model narrative word budget.
  const deterministic = new Set([
    'Mechanical citation checks do not establish semantic truth. Review explanations against source.',
    'Static file references are not a complete call graph. Tests were not executed.',
    'Partial coverage: unsupported, unreadable, oversized, sensitive or invalid source remains unanalyzed; see the inventory report.',
    'No analyzable evidence establishes this folder’s purpose or behavior.',
  ]);
  for (const paragraph of coverage.slice(2, -1)) {
    const text = plain(paragraph.slice(2));
    if (!deterministic.has(text)) narrative.push(text);
  }
  const words = narrative.join(' ').trim();
  requireValue(
    !words ||
      words.split(/\s+/u).length <=
        (folder.path === '.'
          ? manifest.selection.configuration.rootWordLimit
          : manifest.selection.configuration.folderWordLimit),
  );
  return { source_path: folder.path, evidence: [...evidence.values()] };
}
