import { z } from 'zod';
import { InventoryCountsSchema } from './inventory.js';
import {
  CoverageSchema,
  DispositionSchema,
  FilePathSchema,
  FolderPathSchema,
  HashSchema,
  ModeSchema,
  SchemaVersionSchema,
  SourceSpanShape,
  TextSchema,
  folderOf,
  issue,
  orderedUnique,
} from './primitives.js';

const evidenceIds = z.array(z.string().regex(/^E[1-9][0-9]*$/)).min(1);
export const SupportingEvidenceSchema = z
  .strictObject({ ...SourceSpanShape, id: z.string().regex(/^E[1-9][0-9]*$/) })
  .superRefine((value, ctx) => {
    if (value.end_line < value.start_line)
      issue(
        ctx,
        ['end_line'],
        'invalid_evidence',
        'Evidence ends before it starts.',
      );
  });
export type SupportingEvidence = z.infer<typeof SupportingEvidenceSchema>;
export const SupportedClaimSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('observed'),
    text: TextSchema,
    evidence_ids: evidenceIds,
    rationale: z.null(),
  }),
  z.strictObject({
    kind: z.literal('inference'),
    text: TextSchema,
    evidence_ids: evidenceIds,
    rationale: TextSchema,
  }),
]);
export type SupportedClaim = z.infer<typeof SupportedClaimSchema>;
export const FolderSummarySchema = z
  .strictObject({
    schema_version: SchemaVersionSchema,
    source_path: FolderPathSchema,
    coverage: CoverageSchema,
    counts: InventoryCountsSchema,
    input_id: HashSchema,
    generation_id: HashSchema,
    purpose: z.array(SupportedClaimSchema),
    files: z.array(
      z.strictObject({
        path: FilePathSchema,
        disposition: DispositionSchema,
        mode: ModeSchema,
        claims: z.array(SupportedClaimSchema),
        limitations: z.array(TextSchema),
      }),
    ),
    interfaces_and_entry_points: z.array(SupportedClaimSchema),
    dependencies_and_consumers: z.array(SupportedClaimSchema),
    feature_flows: z.array(SupportedClaimSchema),
    tests: z.array(
      z.strictObject({
        path: FilePathSchema,
        text: TextSchema,
        evidence_ids: evidenceIds,
        execution: z.literal('not-run'),
      }),
    ),
    children: z.array(
      z.strictObject({ path: FolderPathSchema, coverage: CoverageSchema }),
    ),
    limitations: z.array(TextSchema),
    evidence: z.array(SupportingEvidenceSchema),
  })
  .superRefine((value, ctx) => {
    orderedUnique(
      value.files.map((file) => file.path),
      ctx,
      ['files'],
    );
    orderedUnique(
      value.children.map((child) => child.path),
      ctx,
      ['children'],
    );
    const evidence = new Map(value.evidence.map((item) => [item.id, item]));
    if (evidence.size !== value.evidence.length)
      issue(
        ctx,
        ['evidence'],
        'duplicate_identity',
        'Evidence IDs must be unique within a folder.',
      );
    const checkClaim = (
      claim: { evidence_ids: string[] },
      path: (string | number)[],
    ): void => {
      if (new Set(claim.evidence_ids).size !== claim.evidence_ids.length)
        issue(
          ctx,
          path,
          'duplicate_identity',
          'A claim cannot repeat an evidence ID.',
        );
      if (claim.evidence_ids.some((id) => !evidence.has(id)))
        issue(
          ctx,
          path,
          'invalid_evidence',
          'Claim cites evidence not present in the folder.',
        );
    };
    for (const section of [
      'purpose',
      'interfaces_and_entry_points',
      'dependencies_and_consumers',
      'feature_flows',
    ] as const)
      value[section].forEach((claim, index) =>
        checkClaim(claim, [section, index]),
      );
    value.files.forEach((file, index) => {
      if (
        folderOf(file.path) !== value.source_path ||
        file.disposition === 'ignored'
      )
        issue(
          ctx,
          ['files', index],
          'invalid_summary',
          'File summary must describe a direct non-ignored file.',
        );
      if (
        file.disposition !== 'analyzed' &&
        (file.claims.length > 0 || file.limitations.length === 0)
      )
        issue(
          ctx,
          ['files', index],
          'invalid_summary',
          'Unanalyzed files need a limitation and no behavioral claims.',
        );
      file.claims.forEach((claim, claimIndex) => {
        checkClaim(claim, ['files', index, 'claims', claimIndex]);
        if (
          !claim.evidence_ids.some((id) => evidence.get(id)?.path === file.path)
        )
          issue(
            ctx,
            ['files', index, 'claims', claimIndex],
            'invalid_evidence',
            'File responsibilities need evidence from that file.',
          );
      });
    });
    value.tests.forEach((entry, index) => {
      checkClaim(entry, ['tests', index]);
      if (
        !entry.evidence_ids.some((id) => evidence.get(id)?.path === entry.path)
      )
        issue(
          ctx,
          ['tests', index],
          'invalid_evidence',
          'Test descriptions need evidence from the inspected test.',
        );
    });
    value.children.forEach((child, index) => {
      if (child.path === '.' || folderOf(child.path) !== value.source_path)
        issue(
          ctx,
          ['children', index],
          'invalid_summary',
          'Child links must point to direct child folders.',
        );
    });
    if (
      (value.coverage === 'partial' ||
        value.children.some((child) => child.coverage === 'partial')) &&
      value.limitations.length === 0
    )
      issue(
        ctx,
        ['limitations'],
        'invalid_summary',
        'Partial coverage needs an explicit limitation.',
      );
    if (
      value.coverage === 'complete' &&
      value.children.some((child) => child.coverage === 'partial')
    )
      issue(
        ctx,
        ['coverage'],
        'invalid_summary',
        'Partial children propagate partial parent coverage.',
      );
  });
export type FolderSummary = z.infer<typeof FolderSummarySchema>;
