import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTree,
  getNodeValue,
  type Node,
  type ParseError,
} from 'jsonc-parser';
import {
  EffectiveConfigSchema,
  type EffectiveConfig,
} from '../core/contracts/index.js';
import { ScanError } from './errors.js';
import { DEFAULT_CONFIGURATION, type ControlFile } from './types.js';
import { sensitiveContent } from './content.js';
import { decode, digest, errorCode, readBounded } from './filesystem.js';

export function readControl(
  root: string,
  path: string,
  controls: Map<string, ControlFile>,
  cache: Map<string, string>,
): string | null {
  const absolute = join(root, path);
  try {
    lstatSync(absolute);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      controls.set(path, { path, sha256: null });
      return null;
    }
    throw new ScanError(
      'control_unreadable',
      'Cannot inspect a selection-control file.',
      path,
    );
  }
  try {
    const result = readBounded(root, absolute, 1048576);
    if (result.oversized || result.bytes.includes(0)) throw new Error();
    const text = decode(result.bytes);
    if (sensitiveContent(text)) throw new Error();
    controls.set(path, { path, sha256: digest(result.bytes) });
    cache.set(path, digest(result.bytes));
    return text;
  } catch {
    throw new ScanError(
      'control_unreadable',
      'Selection-control file must be regular UTF-8 text, at most 1 MiB, and pass credential screening.',
      path,
    );
  }
}
function uniqueKeys(node: Node): void {
  if (node.type === 'object') {
    const keys =
      node.children?.map((child) => child.children?.[0]?.value as string) ?? [];
    if (new Set(keys).size !== keys.length)
      throw new ScanError(
        'invalid_configuration',
        'Duplicate configuration keys are forbidden.',
        'shcontext.config.json',
      );
  }
  node.children?.forEach(uniqueKeys);
}
export function loadConfiguration(text: string | null): EffectiveConfig {
  if (text === null) return { ...DEFAULT_CONFIGURATION };
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });
  if (!tree || errors.length || tree.type !== 'object')
    throw new ScanError(
      'invalid_configuration',
      'Configuration must be a strict JSON object.',
      'shcontext.config.json',
    );
  uniqueKeys(tree);
  const value: unknown = getNodeValue(tree);
  if ((value as Record<string, unknown>)['version'] !== 1)
    throw new ScanError(
      'invalid_configuration',
      'Configuration requires version 1.',
      'shcontext.config.json',
    );
  const result = EffectiveConfigSchema.safeParse({
    ...DEFAULT_CONFIGURATION,
    ...(value as object),
  });
  if (!result.success)
    throw new ScanError(
      'invalid_configuration',
      'Configuration contains unknown keys or invalid values.',
      'shcontext.config.json',
    );
  return result.data;
}
