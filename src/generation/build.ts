import { Coordinator } from '../agents/coordinator.js';
import { AgentExecutionError } from '../agents/errors.js';
import { reviewSummaries, ReviewError } from '../agents/verifier.js';
import type { ExecutionOptions, ExecutionReport } from '../agents/types.js';
import { realpathSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanRepository, ScanError } from '../scanner/index.js';
import { byteOrder } from '../scanner/filesystem.js';
import type { ContractBundle } from '../core/contracts/index.js';
import {
  OpenAIProvider,
  type ModelProvider,
  type CancellationSignal,
} from '../providers/index.js';
import { summarize, throwIfCancelled } from './summarize.js';
import { assembleGeneration } from './assembly.js';
import { BuildError } from './errors.js';
import type { SourceChanges } from '../update/changes.js';
import {
  readOwnedTree,
  withPublicationLock,
  publish,
} from '../storage/publication.js';

export interface BuildOptions {
  provider?: ModelProvider;
  signal?: CancellationSignal;
  execution?: ExecutionOptions;
  /** Explicit extra model requests for fallible source-based review before publication. */
  review?: boolean;
}
export interface BuildResult {
  bundle: ContractBundle;
  output_paths: string[];
  execution: ExecutionReport;
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
  if (identity.id === 'host' && !options.provider)
    throw new BuildError(
      'host_workflow_required',
      'Host generation uses prepare, submit and finalize; no API fallback was selected.',
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
    if (options.review !== undefined && typeof options.review !== 'boolean')
      throw new BuildError(
        'agent_configuration',
        'Review must be an explicit boolean.',
      );
    const coordinator = new Coordinator(provider, {
      ...options.execution,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    try {
      const previous = incremental ? readOwnedTree(root) : null;
      const collected = await summarize(
        root,
        scan,
        coordinator.signal,
        previous?.cache,
        coordinator,
      );
      const { folders, regenerated, reused, sources } = collected;
      await reviewSummaries(
        coordinator,
        folders,
        sources,
        options.review ?? false,
      );
      const { bundle, outputs, unchanged, changes } = assembleGeneration(
        root,
        scan,
        collected,
        previous,
      );
      if (!unchanged)
        publish(root, outputs, initial, () => {
          throwIfCancelled(options.signal);
          if (
            scanRepository(root).inventory.input_id !== scan.inventory.input_id
          )
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
      coordinator.record('Coordinator', '.', 'completed');
      const execution = coordinator.report();
      return {
        execution,
        bundle,
        output_paths: [...outputs.keys()].sort(byteOrder),
        changed: !unchanged,
        regenerated,
        reused,
        model_calls: execution.requests,
        changes,
      };
    } catch (error) {
      coordinator.cancel();
      const execution = coordinator.report();
      if (error instanceof ReviewError) {
        error.execution = execution;
        throw error;
      }
      throw new AgentExecutionError(
        error instanceof BuildError || error instanceof ScanError
          ? error.code
          : 'agent_failed',
        error instanceof BuildError || error instanceof ScanError
          ? error.message
          : 'Agent workflow failed; inspect context and publication state before retrying.',
        execution,
      );
    } finally {
      coordinator.close();
    }
  });
}
