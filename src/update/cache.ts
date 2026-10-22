import { z } from 'zod';
import { FolderSummarySchema, HashSchema } from '../core/contracts/index.js';
import { orderedUnique, issue } from '../core/contracts/primitives.js';

export const CACHE_PATH = 'context/.shcontext/cache.json';
/** Versioned, portable structured summaries; never source bodies or model responses. */
export const IncrementalCacheSchema = z
  .strictObject({
    version: z.literal(1),
    input_id: HashSchema,
    generation_id: HashSchema,
    folders: z
      .array(
        z.strictObject({
          input_hash: HashSchema,
          summary: FolderSummarySchema,
        }),
      )
      .min(1),
  })
  .superRefine((cache, ctx) => {
    orderedUnique(
      cache.folders.map((item) => item.summary.source_path),
      ctx,
      ['folders'],
    );
    if (
      cache.folders.some(
        (item) =>
          item.summary.input_id !== cache.input_id ||
          item.summary.generation_id !== cache.generation_id,
      )
    )
      issue(
        ctx,
        ['folders'],
        'invalid_summary',
        'Cached summaries must belong to the recorded snapshot.',
      );
  });
export type IncrementalCache = z.infer<typeof IncrementalCacheSchema>;
