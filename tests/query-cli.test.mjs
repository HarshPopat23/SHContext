import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { built, fixture, put } from './helpers/query.mjs';
import { snapshot } from './helpers/verification.mjs';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
function invoke(args, cwd) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, OPENAI_API_KEY: '' },
  });
  assert.ifError(r.error);
  return r;
}
for (const args of [
  ['query'],
  ['query', 'q', 'extra'],
  ['query', 'q', '--version'],
  ['query', 'q', '--depth', '4'],
  ['query', 'q', '--limit', 'NaN'],
  ['query', 'q', '--workers', '2'],
])
  test(`query CLI rejects invalid arguments ${args}`, () => {
    const r = invoke(args);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
  });
test('query help needs no repository or credentials', () => {
  const r = invoke(['query', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /query <question>/);
});
test('question-only CLI invocation searches the current directory and answers with source references', async (t) => {
  const root = await built(t),
    before = snapshot(root),
    r = invoke(['query', 'Where is authentication handled?'], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /src\/auth\/session.ts:[0-9]/);
  assert.match(r.stdout, /verifySession/);
  assert.deepEqual(snapshot(root), before);
});
test('query --root and --json return typed retrieval metadata', async (t) => {
  const root = await built(t),
    r = invoke(['query', 'verifySession', '--root', root, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.status, 'answered');
  assert.equal(data.context.state, 'fresh');
});
for (const state of ['missing', 'stale', 'invalid'])
  test(`${state} query context is visible with exit 1 and current source results`, async (t) => {
    const root = state === 'missing' ? fixture(t) : await built(t);
    if (state === 'stale')
      put(root, 'src/auth/new.ts', 'export const addition=1;');
    if (state === 'invalid') put(root, 'context/CONTEXT.md', 'corrupt');
    const before = snapshot(root),
      r = invoke(['query', 'authentication', '--root', root, '--json']);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).status, `context_${state}`);
    assert.deepEqual(snapshot(root), before);
  });
test('unmatched question returns an honest no-match result and exit 2', async (t) => {
  const root = await built(t),
    r = invoke(['query', 'quantum teleportation', '--root', root, '--json']);
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).status, 'no_match');
});
