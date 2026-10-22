import type {
  EffectiveConfig,
  InventoryEntry,
} from '../core/contracts/index.js';
import type { ControlFile } from './types.js';
import { byteOrder, digest } from './filesystem.js';
function tuples(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.entries(value)
      .sort(([a], [b]) => byteOrder(a, b))
      .map(([key, item]) => [key, tuples(item)]);
  return value;
}
export function policyIdentity(
  configuration: EffectiveConfig,
  controls: ControlFile[],
  defaultPolicy: string,
  detector: string,
): string {
  return digest(
    JSON.stringify([
      'policy-v1',
      tuples(configuration),
      controls.map((file) => [file.path, file.sha256]),
      defaultPolicy,
      detector,
    ]),
  );
}
export function inputIdentity(
  policy: string,
  entries: InventoryEntry[],
): string {
  return digest(
    JSON.stringify([
      'input-v1',
      policy,
      entries.map((entry) => [
        entry.path,
        entry.kind,
        entry.disposition,
        entry.reason,
        entry.mode,
        entry.sha256,
      ]),
    ]),
  );
}
