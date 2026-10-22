import { posix } from 'node:path';
import type { FolderSummary, SupportedClaim } from '../core/contracts/index.js';
import { contextPath } from './summarize.js';

/** Treat prose and paths as plain text, including HTML, tables and newlines. */
export function escapeMarkdown(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_[\]{}()#+.!|~$-]/g, '\\$&')
    .replace(/\r\n|\r|\n/g, ' ');
}
export function relativeLink(document: string, target: string): string {
  return posix
    .relative(posix.dirname(document), target)
    .split('/')
    .map((part) =>
      part === '..'
        ? part
        : encodeURIComponent(part).replace(
            /[!'()*]/g,
            (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
          ),
    )
    .join('/');
}
const refs = (ids: string[]) =>
  ids.map((id) => `[${id}](#${id.toLowerCase()})`).join(' ');
const claim = (value: SupportedClaim) =>
  `${value.kind === 'inference' ? '**Inference:** ' : ''}${escapeMarkdown(value.text)} ${refs(value.evidence_ids)}${value.rationale === null ? '' : ` Reasoning: ${escapeMarkdown(value.rationale)}`}`;
const section = (title: string, lines: string[]) =>
  `## ${title}\n\n${lines.length ? lines.join('\n\n') : 'Not established from inspected evidence.'}\n`;

export function renderFolder(folder: FolderSummary): string {
  const document = contextPath(folder.source_path);
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const lines = [
    '---',
    'schema_version: 1',
    `source_path: ${quote(folder.source_path)}`,
    `coverage: ${quote(folder.coverage)}`,
    `input_id: ${quote(folder.input_id)}`,
    `generation_id: ${quote(folder.generation_id)}`,
    '---',
    '',
    `# Context: ${escapeMarkdown(folder.source_path)}`,
    '',
  ];
  lines.push(section('Purpose', folder.purpose.map(claim)));
  lines.push(
    section(
      'Files and responsibilities',
      folder.files.map((file) =>
        `- [${escapeMarkdown(file.path)}](${relativeLink(document, file.path)}) — ${file.mode}; ${file.disposition}. ${file.claims.map(claim).join(' ')} ${file.limitations.map(escapeMarkdown).join(' ')}`.trimEnd(),
      ),
    ),
  );
  lines.push(
    section(
      'Interfaces and entry points',
      folder.interfaces_and_entry_points.map(claim),
    ),
  );
  lines.push(
    section(
      'Dependencies and consumers',
      folder.dependencies_and_consumers.map(claim),
    ),
  );
  lines.push(section('Feature flows', folder.feature_flows.map(claim)));
  lines.push(
    section(
      'Tests',
      folder.tests.map(
        (item) =>
          `- [${escapeMarkdown(item.path)}](${relativeLink(document, item.path)}): ${escapeMarkdown(item.text)} ${refs(item.evidence_ids)} Inspected only; not executed.`,
      ),
    ),
  );
  lines.push(
    section(
      'Child folders',
      folder.children.map(
        (child) =>
          `- [${escapeMarkdown(child.path)}](${relativeLink(document, contextPath(child.path))}) — ${child.coverage}.`,
      ),
    ),
  );
  lines.push(
    section('Coverage and limitations', [
      `Coverage: ${folder.coverage}. Counts describe observed subtree entries; pruned descendants are unknown.`,
      '| Kind | Analyzed | Inventory-only | Ignored | Skipped | Unreadable | Parse-error |\n| --- | --- | --- | --- | --- | --- | --- |\n' +
        (['files', 'directories'] as const)
          .map(
            (kind) =>
              `| ${kind} | ${Object.values(folder.counts[kind]).join(' | ')} |`,
          )
          .join('\n'),
      ...folder.limitations.map((value) => `- ${escapeMarkdown(value)}`),
      `[Inventory and exclusion reasons](${relativeLink(document, 'context/.shcontext/report.json')}).`,
    ]),
  );
  lines.push(
    section(
      'Evidence',
      folder.evidence.map(
        (item) =>
          `### ${item.id}\n\n[${escapeMarkdown(item.path)}](${relativeLink(document, item.path)}) — lines ${item.start_line}–${item.end_line}; basis: ${item.basis}; symbol: ${item.symbol === null ? 'none' : escapeMarkdown(item.symbol)}; SHA-256: \`${item.sha256}\`.`,
      ),
    ),
  );
  return `${lines.join('\n').trimEnd()}\n`;
}
