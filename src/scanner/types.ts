import type { EffectiveConfig } from '../core/contracts/index.js';

export const DEFAULT_CONFIGURATION: Readonly<EffectiveConfig> = Object.freeze({
  version: 1,
  maxFileBytes: 1048576,
  maxInputBytes: 20971520,
  maxEntries: 10000,
  folderWordLimit: 600,
  rootWordLimit: 1200,
  provider: null,
});
export interface ControlFile {
  path: string;
  sha256: string | null;
}
