import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getProjectInfo } from '../dist/index.js';

const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));

function invoke(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    ...options,
  });
  assert.ifError(result.error);
  return result;
}

for (const args of [[], ['--help'], ['-h']]) {
  test(`help is available for ${JSON.stringify(args)}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Usage: shcontext \[options\]/);
    assert.match(result.stdout, /scan <directory>/);
  });
}

for (const option of ['--version', '-v']) {
  test(`${option} matches package metadata`, () => {
    const result = invoke([option]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${getProjectInfo().version}\n`);
    assert.equal(result.stderr, '');
  });
}

for (const args of [['--unknown'], ['--help=invalid'], ['mystery'], ['--']]) {
  test(`invalid invocation fails: ${JSON.stringify(args)}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /shcontext --help/);
  });
}

test('planned commands fail explicitly instead of pretending to analyze', () => {
  for (const command of ['query']) {
    const result = invoke([command, '.']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /not implemented in this foundation/);
  }
});

test('help works in an unrelated directory without reading project configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shcontext cwd '));
  try {
    writeFileSync(join(directory, 'shcontext.config.json'), 'not valid json');
    const result = invoke(['--help'], { cwd: directory });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(readdirSync(directory), ['shcontext.config.json']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
