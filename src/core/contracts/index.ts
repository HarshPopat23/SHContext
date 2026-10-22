import { z } from 'zod';
import { RepositoryAnalysisSchema } from './structure.js';
import { FileAnalysisSchema, DependencyEdgeSchema } from './analysis.js';
import { ContractBundleSchema } from './bundle.js';
import {
  ValidationFindingSchema,
  VerificationResultSchema,
} from './findings.js';
import type { ValidationFinding } from './findings.js';
import { FolderSummarySchema } from './folder.js';
import { RepositoryInventorySchema } from './inventory.js';
import { GenerationManifestSchema } from './manifest.js';
import { FindingCodeSchema, SCHEMA_VERSION } from './primitives.js';

export * from './analysis.js';
export * from './structure.js';
export * from './bundle.js';
export * from './findings.js';
export * from './folder.js';
export * from './inventory.js';
export * from './manifest.js';
export {
  SCHEMA_VERSION,
  SchemaVersionSchema,
  HashSchema,
  FilePathSchema,
  FolderPathSchema,
  EffectiveConfigSchema,
  SourceSpanSchema,
} from './primitives.js';
export type {
  EffectiveConfig,
  SourceSpan,
  Coverage,
  FindingCode,
} from './primitives.js';

export const contractSchemas = Object.freeze({
  repositoryInventory: RepositoryInventorySchema,
  repositoryAnalysis: RepositoryAnalysisSchema,
  fileAnalysis: FileAnalysisSchema,
  dependencyEdge: DependencyEdgeSchema,
  folderSummary: FolderSummarySchema,
  generationManifest: GenerationManifestSchema,
  validationFinding: ValidationFindingSchema,
  verificationResult: VerificationResultSchema,
  bundle: ContractBundleSchema,
});
export type ContractName = keyof typeof contractSchemas;
export type ContractData = {
  [K in ContractName]: z.infer<(typeof contractSchemas)[K]>;
};
export type ContractValidation<T> =
  | { success: true; data: T }
  | { success: false; findings: ValidationFinding[] };

/** Validate already-decoded data. Never log values, read files, or claim freshness. */
export function validateContract<K extends ContractName>(
  name: K,
  input: unknown,
): ContractValidation<ContractData[K]> {
  if (!Object.hasOwn(contractSchemas, name))
    return {
      success: false,
      findings: [
        {
          schema_version: SCHEMA_VERSION,
          code: 'unknown_contract',
          severity: 'error',
          path: null,
          pointer: '',
          message: 'Unknown contract name.',
        },
      ],
    };
  const result = contractSchemas[name].safeParse(input);
  if (result.success)
    return { success: true, data: result.data as ContractData[K] };
  return {
    success: false,
    findings: result.error.issues.map((entry) => {
      const code =
        entry.code === 'custom'
          ? FindingCodeSchema.safeParse(entry.params?.['finding_code'])
          : null;
      return {
        schema_version: SCHEMA_VERSION,
        code: code?.success ? code.data : 'schema_violation',
        severity: 'error',
        path: null,
        pointer:
          entry.path.length === 0
            ? ''
            : `/${entry.path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`,
        message: code?.success
          ? entry.message
          : 'Record violates the shared data contract. Inspect the indicated field and contract documentation.',
      };
    }),
  };
}
