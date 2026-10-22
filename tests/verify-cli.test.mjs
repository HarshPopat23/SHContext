import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  ['verify'],
  ['verify', '.', 'extra'],
  ['verify', '.', '--version'],
])
  test(`verify validates arguments ${args}`, () => {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage: shcontext verify/);
  });
test('verify help requires neither a root nor credentials', () => {
  const result = invoke(['verify', 'nonexistent', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /verify <directory>/);
});
for (const partial of [false, true])
  test(`CLI returns fresh ${partial ? 'partial' : 'complete'} JSON with the correct exit code`, async (t) => {
    const { root } = await built(t, { partial });
    const before = snapshot(root);
    const result = invoke(['verify', root]);
    assert.equal(result.status, partial ? 2 : 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.state, 'fresh');
    assert.equal(json.coverage, partial ? 'partial' : 'complete');
    assert.match(result.stderr, /do not establish explanation accuracy/);
    assert.deepEqual(snapshot(root), before);
  });
for (const state of ['stale', 'unknown', 'invalid'])
  test(`CLI returns ${state} and exit 1 without writes`, async (t) => {
    const { root } = await built(t);
    if (state === 'stale') put(root, 'src/new.ts', 'export const added=1;');
    if (state === 'unknown')
      put(root, 'shcontext.config.json', 'not valid json');
    if (state === 'invalid') put(root, 'context/CONTEXT.md', 'malformed');
    const before = snapshot(root);
    const result = invoke(['verify', root]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).state, state);
    assert.deepEqual(snapshot(root), before);
  });
