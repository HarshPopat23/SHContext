import { realpathSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanRepository } from '../scanner/index.js';
import { digest, byteOrder } from '../scanner/filesystem.js';
import {
  ContractBundleSchema,
  GenerationManifestSchema,
  needsManifestFile,
  isPartial,
  type AnalysisFailure,
  type ContractBundle,
} from '../core/contracts/index.js';
import {
  OpenAIProvider,
  type ModelProvider,
  type CancellationSignal,
} from '../providers/index.js';
import { summarize, contextPath, throwIfCancelled } from './summarize.js';
import { renderFolder } from './render.js';
import { BuildError } from './errors.js';
import { CACHE_PATH } from '../update/cache.js';
import {
  sourceChanges,
  gitHead,
  type SourceChanges,
} from '../update/changes.js';
import {
  readOwnedTree,
  withPublicationLock,
  publish,
} from '../storage/publication.js';

export interface BuildOptions {
  provider?: ModelProvider;
  signal?: CancellationSignal;
}
export interface BuildResult {
  bundle: ContractBundle;
  output_paths: string[];
}
export interface UpdateResult extends BuildResult {
  changed: boolean;
  regenerated: string[];
  reused: string[];
  model_calls: number;
  changes: SourceChanges;
}
/** Build current eligible source with a bounded provider, validate all drafts, then publish once. */
export async function buildRepository(
  selectedRoot: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  return runGeneration(selectedRoot, options, false);
}

/** Shared writer: update may reuse structured records, build always regenerates. */
export async function runGeneration(
  selectedRoot: string,
  options: BuildOptions,
  incremental: boolean,
): Promise<UpdateResult> {
  throwIfCancelled(options.signal);
  const scan = scanRepository(selectedRoot);
  const requested = resolve(selectedRoot);
  if (lstatSync(requested).isSymbolicLink())
    throw new BuildError('source_changed', 'Selected root became a symlink.');
  const root = realpathSync(requested);
  const identity = scan.configuration.provider;
  if (!identity)
    throw new BuildError(
      'provider_configuration',
      'Configure provider id and model in shcontext.config.json. OpenAI also requires OPENAI_API_KEY in the host environment.',
    );
  let adapter: ModelProvider | undefined;
  const getProvider = (): ModelProvider => {
    if (adapter) return adapter;
    const provider =
      options.provider ??
      (identity.id === 'openai'
        ? new OpenAIProvider({
            model: identity.model,
            apiKey: process.env['OPENAI_API_KEY'] ?? '',
          })
        : null);
    if (
      !provider ||
      provider.identity.id !== identity.id ||
      provider.identity.model !== identity.model
    )
      throw new BuildError(
        'provider_configuration',
        'Configured provider/model does not match the selected adapter; no fallback destination was selected.',
      );
    adapter = provider;
    return provider;
  };
  const provider: ModelProvider = incremental
    ? { identity, generate: (request) => getProvider().generate(request) }
    : getProvider();
  return withPublicationLock(root, async (initial) => {
    const previous = incremental ? readOwnedTree(root) : null;
    const {
      report,
      folders,
      generation,
      generation_id,
      cache,
      regenerated,
      reused,
      model_calls,
    } = await summarize(root, scan, provider, options.signal, previous?.cache);
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
    if (!unchanged)
      publish(root, outputs, initial, () => {
        throwIfCancelled(options.signal);
        if (scanRepository(root).inventory.input_id !== scan.inventory.input_id)
          throw new BuildError(
            'source_changed',
            'Selected inputs changed before publication; previous context was retained.',
          );
      });
    if (unchanged) throwIfCancelled(options.signal);
    if (
      unchanged &&
      scanRepository(root).inventory.input_id !== scan.inventory.input_id
    )
      throw new BuildError(
        'source_changed',
        'Selected inputs changed during update; previous context was retained.',
      );
    if (unchanged && readOwnedTree(root)?.identity !== initial)
      throw new BuildError(
        'output_ownership',
        'Output changed during update; no context was published.',
      );
    return {
      bundle,
      output_paths: [...outputs.keys()].sort(byteOrder),
      changed: !unchanged,
      regenerated,
      reused,
      model_calls,
      changes,
    };
  });
}
