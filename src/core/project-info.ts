import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Package identity shared by the library and CLI. Not a repository schema. */
export interface ProjectInfo {
  readonly name: string;
  readonly version: string;
  readonly description: string;
}

/** Read this installed package's identity independently of the caller's cwd. */
export function getProjectInfo(): ProjectInfo {
  const metadata = require('../../package.json') as ProjectInfo;
  return {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
  };
}
