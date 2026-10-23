import type { ScanResult } from '../scanner/index.js';
import { digest, byteOrder } from '../scanner/filesystem.js';
import {
  ContractBundleSchema,
  GenerationManifestSchema,
  needsManifestFile,
  isPartial,
  type AnalysisFailure,
} from '../core/contracts/index.js';
import { sourceChanges, gitHead } from '../update/changes.js';
import { CACHE_PATH } from '../update/cache.js';
import type { OwnedSnapshot } from '../storage/publication.js';
import { contextPath, type summarize } from './summarize.js';
import { renderFolder } from './render.js';

/** Assemble structured records before any publication; used by API and host workflows. */
export function assembleGeneration(
  root: string,
  scan: ScanResult,
  collected: Awaited<ReturnType<typeof summarize>>,
  previous: OwnedSnapshot | null,
) {
  const { report, folders, generation, generation_id, cache, regenerated } =
    collected;
  const changes = sourceChanges(
    root,
    previous?.inventory ?? null,
    scan.inventory,
    previous?.manifest.provenance.git_head ?? null,
  );
  const unchanged =
    !!previous &&
    previous.manifest.input_id === scan.inventory.input_id &&
    previous.manifest.generator.generation_id === generation_id &&
    regenerated.length === 0;
  const outputs = new Map<string, string>();
  for (const folder of folders)
    outputs.set(contextPath(folder.source_path), renderFolder(folder));
  outputs.set(
    'context/.shcontext/report.json',
    `${JSON.stringify(scan.inventory, null, 2)}\n`,
  );
  outputs.set(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  const newManifest = GenerationManifestSchema.parse({
    schema_version: 1,
    generator: { version: generation.generator, generation_id },
    generation,
    selection: {
      configuration: scan.configuration,
      control_files: scan.control_files,
    },
    input_id: scan.inventory.input_id,
    coverage: scan.inventory.coverage,
    provenance: unchanged
      ? previous.manifest.provenance
      : { git_head: gitHead(root) },
    files: scan.inventory.entries
      .filter(needsManifestFile)
      .map(({ path, sha256, disposition, reason, mode }) => ({
        path,
        sha256,
        disposition,
        reason,
        mode,
      })),
    directories: folders.map((folder) => ({
      path: folder.source_path,
      coverage: folder.coverage,
    })),
    outputs: [...outputs]
      .map(([path, content]) => ({ path, sha256: digest(content) }))
      .sort((a, b) => byteOrder(a.path, b.path)),
    analysis_failures: scan.inventory.entries
      .filter(isPartial)
      .map((entry) => ({
        path: entry.path,
        code: entry.reason as AnalysisFailure['code'],
        message:
          'Source analysis is incomplete for the recorded reason; no unsupported behavior is claimed.',
      })),
    diagnostics: [],
  });
  const manifest = unchanged ? previous.manifest : newManifest;
  const bundle = ContractBundleSchema.parse({
    schema_version: 1,
    inventory: scan.inventory,
    analyses: report.analyses,
    edges: report.edges,
    folders,
    manifest,
  });
  outputs.set(
    'context/.shcontext/manifest.json',
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { bundle, outputs, unchanged, changes };
}
