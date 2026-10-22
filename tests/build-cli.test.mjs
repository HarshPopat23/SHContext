import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixture, put } from './helpers/generation.mjs';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
function invoke(args, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, OPENAI_API_KEY: '', ...env },
  });
  assert.ifError(result.error);
  return result;
}
for (const args of [
  ['build'],
  ['build', '.', 'extra'],
  ['build', '--version', '.'],
])
  test(`build validates CLI arguments: ${args}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: shcontext build/);
    assert.equal(result.stdout, '');
  });
test('build help does not read the root or require credentials', () => {
  const result = invoke(['build', 'does-not-exist', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /build <directory>/);
  assert.equal(result.stderr, '');
});
test('missing credentials/configuration fail safely before model work or output changes', (t) => {
  const root = fixture(t);
  let result = invoke(['build', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /provider_configuration/);
  assert.equal(result.stdout, '');
  assert.ok(!readdirSync(root).includes('.shcontext'));
  put(root, 'shcontext.config.json', '{"version":1}');
  result = invoke(['build', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /provider_configuration/);
});
for (const partial of [false, true])
  test(`CLI publishes a deterministic ${partial ? 'partial' : 'complete'} inventory-only tree without a model call`, (t) => {
    const root = fixture(t, { sources: false });
    put(root, '.shcontextignore', 'shcontext.config.json\n.shcontextignore\n');
    if (partial) put(root, 'tool.py', 'print("not sent")');
    const result = invoke(['build', root], {
      OPENAI_API_KEY: 'test-placeholder-not-used',
    });
    assert.equal(result.status, partial ? 2 : 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.coverage, partial ? 'partial' : 'complete');
    assert.ok(json.output_paths.includes('context/CONTEXT.md'));
    assert.match(
      readFileSync(join(root, 'context/CONTEXT.md'), 'utf8'),
      /## Evidence/,
    );
    const second = invoke(['build', root], {
      OPENAI_API_KEY: 'test-placeholder-not-used',
    });
    assert.equal(second.status, result.status);
    assert.equal(second.stdout, result.stdout);
  });
