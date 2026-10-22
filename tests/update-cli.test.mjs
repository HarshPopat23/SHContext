import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { built, put, snapshot } from './helpers/verification.mjs';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
function invoke(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, OPENAI_API_KEY: '' },
  });
  assert.ifError(result.error);
  return result;
}
for (const args of [
  ['update'],
  ['update', '.', 'extra'],
  ['update', '.', '--version'],
])
  test(`update validates arguments ${args}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage: shcontext update/);
  });
test('update help requires neither root nor credentials', () => {
  const result = invoke(['update', 'missing', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /update <directory>/);
});
for (const partial of [false, true])
  test(`update no-op returns ${partial ? 'partial' : 'complete'} with zero requests and correct exit status`, async (t) => {
    const { root } = await built(t, { partial }),
      before = snapshot(root),
      result = invoke(['update', root]);
    assert.equal(result.status, partial ? 2 : 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.changed, false);
    assert.equal(data.model_calls, 0);
    assert.match(result.stderr, /context unchanged/);
    assert.doesNotMatch(result.stderr, /published/);
    assert.deepEqual(data.regenerated, []);
    assert.deepEqual(snapshot(root), before);
  });
test('update needing a model fails safely when host credentials are unavailable', async (t) => {
  const { root } = await built(t);
  put(root, 'src/new.ts', 'export const newFile=1;');
  const before = snapshot(join(root, 'context')),
    result = invoke(['update', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /provider_configuration/);
  assert.deepEqual(snapshot(join(root, 'context')), before);
});
test('update refuses unowned context without overwriting user notes', async (t) => {
  const { root } = await built(t);
  put(root, 'context/notes.txt', 'user-owned');
  const before = snapshot(root),
    result = invoke(['update', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /output_ownership/);
  assert.deepEqual(snapshot(root), before);
});
