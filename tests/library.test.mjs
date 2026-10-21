import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getProjectInfo } from '../dist/index.js';
import { getProjectInfo as getCoreProjectInfo } from '../dist/core/index.js';

test('root and core exports expose the package identity', () => {
  const metadata = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(getProjectInfo(), {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
  });
  assert.equal(getProjectInfo, getCoreProjectInfo);
});

test('importing the library does not run the CLI', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "await import('shcontext')",
      '--',
      '--help',
    ],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
