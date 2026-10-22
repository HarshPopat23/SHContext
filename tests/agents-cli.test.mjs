import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildRepository } from '../dist/index.js';
import { fixture, provider, put } from './helpers/agents.mjs';
import { snapshot } from './helpers/verification.mjs';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
function invoke(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, OPENAI_API_KEY: 'unused-test-key' },
  });
  assert.ifError(r.error);
  return r;
}
for (const args of [
  ['--workers', '0'],
  ['--workers', '9'],
  ['--workers', '1.5'],
  ['--retries', '3'],
  ['--max-requests', '0'],
  ['--max-cost-usd', '1'],
])
  test(`invalid role controls ${args} fail without model calls or context changes`, async (t) => {
    const root = fixture(t);
    await buildRepository(root, { provider: provider() });
    const before = snapshot(root);
    const r = invoke(['update', root, ...args]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /agent_configuration/);
    assert.deepEqual(snapshot(root), before);
  });
test('bounded role controls are honored by a credential-free no-op update', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: provider() });
  const before = snapshot(root);
  const r = invoke(['update', root, '--workers', '4', '--max-requests', '1']);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.execution.workers, 4);
  assert.equal(data.execution.requests, 0);
  assert.equal(data.changed, false);
  assert.deepEqual(snapshot(root), before);
});
test('CLI spending cap prevents paid work before a changed update sends a request', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: provider() });
  put(root, 'feature-0/index.ts', 'export const changed=1;');
  const before = snapshot(root);
  const r = invoke([
    'update',
    root,
    '--max-cost-usd',
    '0',
    '--input-usd-per-million',
    '1',
    '--output-usd-per-million',
    '1',
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /agent_budget/);
  assert.deepEqual(snapshot(root), before);
});
for (const command of ['scan', 'verify'])
  test(`role options do not silently affect ${command}`, () => {
    const r = invoke([command, '.', '--workers', '2']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Options do not apply/);
  });
