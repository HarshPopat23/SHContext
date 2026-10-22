import { ScanError } from './errors.js';
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decode, errorCode } from './filesystem.js';

export function tracking(root: string): {
  files: Set<string>;
  ancestors: Set<string>;
  submodules: Set<string>;
} {
  const files = new Set<string>(),
    ancestors = new Set<string>(),
    submodules = new Set<string>();
  let current = root;
  while (true) {
    try {
      lstatSync(join(current, '.git'));
      break;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        throw new ScanError(
          'git_unavailable',
          'Cannot establish repository tracking status.',
        );
    }
    const parent = dirname(current);
    if (parent === current) return { files, ancestors, submodules };
    current = parent;
  }
  // Do not inherit index/worktree overrides or run repository hooks, filters or pagers.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  const result = spawnSync(
    'git',
    [
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      '-C',
      root,
      'ls-files',
      '--stage',
      '-z',
      '--',
      '.',
    ],
    {
      env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new ScanError(
      'git_unavailable',
      'Git tracking discovery failed; install Git and check the checkout/index.',
    );
  let output: string;
  try {
    output = decode(result.stdout);
  } catch {
    throw new ScanError(
      'unsupported_path',
      'Git index contains a non-UTF-8 path.',
    );
  }
  for (const record of output.split('\0').filter(Boolean)) {
    const split = record.indexOf('\t');
    if (split < 0)
      throw new ScanError(
        'git_unavailable',
        'Git returned an invalid index record.',
      );
    const path = record.slice(split + 1);
    if (record.startsWith('160000 ')) submodules.add(path);
    else files.add(path);
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++)
      ancestors.add(segments.slice(0, i).join('/'));
  }
  return { files, ancestors, submodules };
}
