import { z } from 'zod';
import { FolderPathSchema, HashSchema } from './primitives.js';

/** Host-provided JSON is untrusted; the normal draft checker validates its contents. */
export const HostSubmissionSchema = z.strictObject({
  session_id: z.string().uuid(),
  request_id: HashSchema,
  draft: z.record(z.string(), z.unknown()),
});
export type HostSubmission = z.infer<typeof HostSubmissionSchema>;
export const HostSessionSchema = z.strictObject({
  version: z.literal(1),
  session_id: z.string().uuid(),
  root: z.string().min(1).max(4096),
  operation: z.enum(['build', 'update']),
  input_id: HashSchema,
  generation_id: HashSchema,
  context_identity: HashSchema.nullable(),
  answers: z.array(HostSubmissionSchema).max(64),
  publication_hash: HashSchema.nullable(),
  completed: z.boolean(),
});
export type HostSession = z.infer<typeof HostSessionSchema>;
export const HostRequestIdentitySchema = z.strictObject({
  session_id: z.string().uuid(),
  request_id: HashSchema,
  source_path: FolderPathSchema,
});

export const HostRequestSchema = z.strictObject({
  protocol: z.literal(1),
  ...HostRequestIdentitySchema.shape,
  role: z.enum(['Folder Analyst', 'Architecture Analyst']),
  instructions: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  draft_schema: z.record(z.string(), z.unknown()),
});
export type HostRequest = z.infer<typeof HostRequestSchema>;
