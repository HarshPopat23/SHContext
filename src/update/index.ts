import {
  runGeneration,
  type BuildOptions,
  type UpdateResult,
} from '../generation/build.js';
export type { UpdateResult } from '../generation/build.js';
export type { SourceChanges } from './changes.js';

/** Re-scan/re-analyze locally; generate only summaries whose complete inputs changed. */
export function updateRepository(
  root: string,
  options: BuildOptions = {},
): Promise<UpdateResult> {
  return runGeneration(root, options, true);
}
