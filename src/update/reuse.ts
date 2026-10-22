import {
  FolderSummarySchema,
  type FolderSummary,
  type SupportingEvidence,
  type RepositoryInventory,
  type DependencyEdge,
} from '../core/contracts/index.js';
import { digest } from '../scanner/filesystem.js';
import { BuildError } from '../generation/errors.js';

/** Global snapshot IDs and sequential citation labels are not semantic folder inputs. */
function normalize(value: unknown, ids: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, ids));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (key === 'input_id' || key === 'generation_id') return [];
      if (key === 'evidence_ids')
        return [[key, (item as string[]).map((id) => ids.get(id))]];
      if (key === 'evidence_id' || key === 'id')
        return [
          [key, typeof item === 'string' ? (ids.get(item) ?? item) : item],
        ];
      return [[key, normalize(item, ids)]];
    }),
  );
}
const entryIdentity = (entry: RepositoryInventory['entries'][number]) => [
  entry.path,
  entry.kind,
  entry.disposition,
  entry.reason,
  entry.mode,
  entry.sha256,
];

export function folderInputHash(
  generation: string,
  policy: string,
  entries: RepositoryInventory['entries'],
  edges: DependencyEdge[],
  inventory: RepositoryInventory,
  input: unknown,
  evidence: Map<string, SupportingEvidence>,
): string {
  const byPath = new Map(inventory.entries.map((entry) => [entry.path, entry]));
  const targets = edges.flatMap((edge) =>
    edge.resolution === 'resolved' ? [entryIdentity(byPath.get(edge.to)!)] : [],
  );
  return digest(
    JSON.stringify([
      'folder-input-v1',
      generation,
      policy,
      entries.map(entryIdentity),
      targets,
      normalize(
        input,
        new Map([...evidence.values()].map((item) => [item.id, item.path])),
      ),
    ]),
  );
}

/** Keep exact claim boundaries; only rebind citation labels and current snapshot metadata. */
export function rebaseSummary(
  summary: FolderSummary,
  evidence: Map<string, SupportingEvidence>,
  input: string,
  generation: string,
): FolderSummary {
  const ids = new Map<string, string>();
  for (const old of summary.evidence) {
    const current = evidence.get(old.path);
    if (
      !current ||
      old.path !== current.path ||
      old.sha256 !== current.sha256 ||
      old.start_line !== current.start_line ||
      old.end_line !== current.end_line ||
      old.symbol !== current.symbol ||
      old.basis !== current.basis
    )
      throw new BuildError(
        'invalid_cache',
        'Cached evidence does not match the current inspected source. Previous context was retained.',
      );
    ids.set(old.id, current.id);
  }
  function remap(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(remap);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === 'evidence_ids'
          ? (item as string[]).map((id) => ids.get(id))
          : key === 'id'
            ? ids.get(item as string)
            : remap(item),
      ]),
    );
  }
  const value = remap(summary) as FolderSummary;
  return FolderSummarySchema.parse({
    ...value,
    input_id: input,
    generation_id: generation,
  });
}
