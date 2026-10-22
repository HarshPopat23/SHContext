import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  VerificationResultSchema,
  type VerificationResult,
  type ValidationFinding,
  type FindingCode,
  type SupportingEvidence,
} from '../core/contracts/index.js';
import { scanRepository, ScanError } from '../scanner/index.js';
import { readOwnedTree } from '../storage/publication.js';
import { inspectSummary } from './summary.js';
import {
  generationId,
  GENERATOR_VERSION,
  RENDERER_VERSION,
  TEMPLATE_VERSION,
} from '../generation/summarize.js';
import { PROMPT_VERSION } from '../generation/draft.js';
import { STRUCTURE_PARSER_VERSION } from '../parsers/syntax.js';
import { RESOLVER_VERSION } from '../graph/index.js';
import {
  DEFAULT_POLICY_VERSION,
  DETECTOR_VERSION,
} from '../scanner/content.js';
import { readBounded, digest, decode } from '../scanner/filesystem.js';

const finding = (
  code: FindingCode,
  message: string,
  path: string | null = null,
): ValidationFinding => ({
  schema_version: 1,
  code,
  severity: 'error',
  path,
  pointer: '',
  message,
});
function stateActive(root: string): boolean {
  try {
    const state = join(root, '.shcontext');
    const stat = lstatSync(state);
    return (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      readdirSync(state).length > 0
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
/** Read-only, offline mechanical verification. Fresh never certifies explanatory accuracy. */
export function verifyRepository(selectedRoot: string): VerificationResult {
  let coverage: VerificationResult['coverage'] = 'partial';
  const finish = (
    state: VerificationResult['state'],
    findings: ValidationFinding[],
  ) =>
    VerificationResultSchema.parse({
      schema_version: 1,
      state,
      coverage,
      findings,
    });
  let root: string;
  try {
    const requested = resolve(selectedRoot);
    const stat = lstatSync(requested);
    if (!selectedRoot || !stat.isDirectory() || stat.isSymbolicLink())
      throw new Error();
    root = realpathSync(requested);
  } catch {
    return finish('unknown', [
      finding(
        'input_unreadable',
        'The selected root must be a readable real directory.',
      ),
    ]);
  }
  try {
    if (stateActive(root))
      return finish('invalid', [
        finding(
          'invalid_manifest',
          'Operational state indicates an active or incomplete build. Verification never recovers or removes state; finish or recover the build first.',
        ),
      ]);
  } catch {
    return finish('invalid', [
      finding(
        'invalid_manifest',
        'Cannot establish an idle publication state.',
      ),
    ]);
  }
  let snapshot: ReturnType<typeof readOwnedTree>;
  try {
    snapshot = readOwnedTree(root);
    if (!snapshot)
      return finish('invalid', [
        finding(
          'output_missing',
          'No complete owned context tree exists. Run shcontext build first.',
        ),
      ]);
    coverage = snapshot.manifest.coverage;
  } catch {
    return finish('invalid', [
      finding(
        'output_modified',
        'Context ownership, required format, links, hashes, coverage or recorded evidence is invalid. Preserve edited files and inspect the output before rebuilding.',
      ),
    ]);
  }
  const { manifest, inventory } = snapshot;
  const stale: ValidationFinding[] = [],
    unknown: ValidationFinding[] = [];
  const installed = {
    ...manifest.generation,
    generator: GENERATOR_VERSION,
    parser: STRUCTURE_PARSER_VERSION,
    resolver: RESOLVER_VERSION,
    prompt: PROMPT_VERSION,
    template: TEMPLATE_VERSION,
    renderer: RENDERER_VERSION,
    detector: DETECTOR_VERSION,
    default_policy: DEFAULT_POLICY_VERSION,
  };
  if (generationId(installed) !== manifest.generator.generation_id)
    stale.push(
      finding(
        'generation_changed',
        'Installed generation components differ from the recorded build; rebuild with the intended versions.',
      ),
    );
  let current: ReturnType<typeof scanRepository>;
  try {
    current = scanRepository(root);
  } catch (error) {
    if (
      error instanceof ScanError &&
      [
        'source_changed',
        'path_collision',
        'unsupported_path',
        'input_limit',
        'entry_limit',
      ].includes(error.code)
    )
      stale.push(
        finding(
          'source_changed',
          'Current source cannot match the recorded valid selection; stabilize or narrow the repository and rebuild.',
        ),
      );
    else
      unknown.push(
        finding(
          'input_unreadable',
          'Current selection or control files cannot be compared. No absent-file assumption was made.',
        ),
      );
    return finish(stale.length ? 'stale' : 'unknown', [...stale, ...unknown]);
  }
  const unreadable = (entry: { disposition: string }) =>
    entry.disposition === 'unreadable';
  const blocked = current.inventory.entries
    .filter((entry) => entry.kind === 'directory' && unreadable(entry))
    .map((entry) => entry.path);
  const masked = (path: string) =>
    blocked.some((prefix) => path !== prefix && path.startsWith(prefix));
  const oldControls = new Map(
    manifest.selection.control_files.map((file) => [file.path, file.sha256]),
  );
  const newControls = new Map(
    current.control_files.map((file) => [file.path, file.sha256]),
  );
  const controlPaths = new Set([...oldControls.keys(), ...newControls.keys()]);
  if (
    JSON.stringify(current.configuration) !==
      JSON.stringify(manifest.selection.configuration) ||
    [...controlPaths].some(
      (path) =>
        !masked(path) && oldControls.get(path) !== newControls.get(path),
    )
  )
    stale.push(
      finding(
        'selection_changed',
        'Effective configuration or exclusion controls changed.',
      ),
    );
  const oldEntries = new Map(
    inventory.entries.map((entry) => [entry.path, entry]),
  );
  const newEntries = new Map(
    current.inventory.entries.map((entry) => [entry.path, entry]),
  );
  const paths = new Set([...oldEntries.keys(), ...newEntries.keys()]);
  const tuple = (entry: (typeof inventory.entries)[number]) =>
    JSON.stringify([
      entry.kind,
      entry.disposition,
      entry.reason,
      entry.mode,
      entry.sha256,
    ]);
  const changed = [...paths].some((path) => {
    if (masked(path)) return false;
    const old = oldEntries.get(path),
      next = newEntries.get(path);
    if (!old || !next || old.kind !== next.kind) return true;
    // Losing access is a comparison failure, not evidence that source bytes changed.
    if (unreadable(next)) return false;
    return tuple(old) !== tuple(next);
  });
  if (changed)
    stale.push(
      finding(
        'source_changed',
        'Selected source paths, types, dispositions or readable content hashes changed. Newly eligible folders require a rebuild.',
      ),
    );
  if (
    current.configuration.provider?.id !== manifest.generation.provider.id ||
    current.configuration.provider?.model !== manifest.generation.provider.model
  ) {
    stale.push(
      finding(
        'generation_changed',
        'Configured provider/model identity changed; verification did not contact it.',
      ),
    );
  }
  const unknownCodes = new Set([
    'permission_denied',
    'read_failed',
    'directory_unreadable',
  ]);
  if (
    current.inventory.entries.some((entry) => unknownCodes.has(entry.reason)) ||
    inventory.entries.some((entry) => unknownCodes.has(entry.reason))
  )
    unknown.push(
      finding(
        'input_unreadable',
        'Included unreadable files or directory boundaries prevent a fully comparable source snapshot.',
      ),
    );
  const currentByPath = new Map(
    current.inventory.entries.map((entry) => [entry.path, entry]),
  );
  const evidence: SupportingEvidence[] = manifest.directories.flatMap(
    (folder) =>
      inspectSummary(
        snapshot.summaries.get(
          folder.path === '.'
            ? 'context/CONTEXT.md'
            : `context/${folder.path}/CONTEXT.md`,
        )!,
        folder,
        manifest,
        inventory,
      ).evidence,
  );
  const lineCounts = new Map<string, number>();
  const invalid: ValidationFinding[] = [];
  for (const entry of inventory.entries) {
    const now = currentByPath.get(entry.path);
    if (
      entry.sha256 !== null &&
      now?.sha256 === entry.sha256 &&
      entry.bytes !== now.bytes
    )
      invalid.push(
        finding(
          'invalid_inventory',
          'Recorded byte count differs from its matching source hash.',
          entry.path,
        ),
      );
  }
  for (const item of evidence) {
    const entry = currentByPath.get(item.path);
    if (entry?.sha256 !== item.sha256 || entry.disposition !== 'analyzed')
      continue; // changed/deleted sources are stale, not old-output corruption
    if (!lineCounts.has(item.path)) {
      try {
        const read = readBounded(
          root,
          join(root, item.path),
          current.configuration.maxFileBytes,
        );
        if (read.oversized || digest(read.bytes) !== item.sha256) {
          stale.push(
            finding(
              'source_changed',
              'An inspected source changed while verifying.',
            ),
          );
          continue;
        }
        const text = decode(read.bytes, true);
        lineCounts.set(
          item.path,
          text.length
            ? 1 + [...text.matchAll(/\r\n|[\n\r\u2028\u2029]/g)].length
            : 0,
        );
      } catch {
        unknown.push(
          finding(
            'input_unreadable',
            'An inspected source could not be rechecked.',
          ),
        );
        continue;
      }
    }
    if (item.end_line > lineCounts.get(item.path)!)
      invalid.push(
        finding(
          'invalid_evidence',
          'Evidence line range exceeds its matching inspected source.',
          item.path,
        ),
      );
  }
  try {
    const end = readOwnedTree(root);
    if (stateActive(root) || !end || end.identity !== snapshot.identity)
      return finish('invalid', [
        finding(
          'output_modified',
          'Output or publication state changed during verification.',
        ),
      ]);
  } catch {
    return finish('invalid', [
      finding(
        'output_modified',
        'Output ownership or integrity changed during verification.',
      ),
    ]);
  }
  try {
    if (scanRepository(root).inventory.input_id !== current.inventory.input_id)
      stale.push(
        finding(
          'source_changed',
          'Selected inputs changed during verification; retry against a stable tree.',
        ),
      );
  } catch {
    unknown.push(
      finding(
        'input_unreadable',
        'Inputs could not be consistently rechecked at the end of verification.',
      ),
    );
  }
  if (invalid.length)
    return finish('invalid', [...invalid, ...stale, ...unknown]);
  return finish(stale.length ? 'stale' : unknown.length ? 'unknown' : 'fresh', [
    ...stale,
    ...unknown,
  ]);
}
