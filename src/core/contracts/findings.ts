import { z } from 'zod';
import {
  CoverageSchema,
  FindingCodeSchema,
  ReportPathSchema,
  SchemaVersionSchema,
  TextSchema,
  issue,
} from './primitives.js';

export const ValidationFindingSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  code: FindingCodeSchema,
  severity: z.enum(['error', 'warning']),
  path: ReportPathSchema.nullable(),
  pointer: z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/),
  message: TextSchema,
});
export type ValidationFinding = z.infer<typeof ValidationFindingSchema>;
export const VerificationResultSchema = z
  .strictObject({
    schema_version: SchemaVersionSchema,
    state: z.enum(['fresh', 'stale', 'unknown', 'invalid']),
    coverage: CoverageSchema,
    findings: z.array(ValidationFindingSchema),
  })
  .superRefine((value, ctx) => {
    const errors = value.findings.some(
      (finding) => finding.severity === 'error',
    );
    if (value.state === 'fresh' && errors)
      issue(
        ctx,
        ['state'],
        'schema_violation',
        'Fresh context cannot have error findings.',
      );
    if (value.state !== 'fresh' && !errors)
      issue(
        ctx,
        ['findings'],
        'schema_violation',
        'A non-fresh result needs an error finding.',
      );
  });
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
