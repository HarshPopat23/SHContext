import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { folderStatus } from '../dist/status/index.js';
import { built, fixture, put } from './helpers/query.mjs';
import { snapshot } from './helpers/verification.mjs';

const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const state = (status, path) => status.folders.find((f) => f.path === path);

test('status reports every folder fresh for an untouched build', async (t) => {
  const root = await built(t);
  const status = folderStatus(root);
  assert.equal(status.state, 'current');
  assert.equal(status.counts.stale, 0);
  assert.ok(status.folders.length >= 4);
  assert.ok(status.folders.every((f) => f.state === 'fresh'));
  assert.deepEqual(status.new_folders, []);
});

test('an edit stales only that folder and its ancestors', async (t) => {
  const root = await built(t);
  const before = snapshot(root);
  put(root, 'src/auth/session.ts', 'export const changed = 1;\n');
  const status = folderStatus(root);
  assert.equal(status.state, 'stale');
  for (const path of ['src/auth', 'src', '.']) {
    assert.equal(state(status, path).state, 'stale', path);
    assert.deepEqual(state(status, path).reasons, ['modified']);
  }
  assert.deepEqual(state(status, 'src/auth').changed_files, [
    'src/auth/session.ts',
  ]);
  for (const path of ['src/billing', 'src/routes'])
    assert.equal(state(status, path).state, 'fresh', path);
  assert.equal(status.verify, 'stale');
  // Read-only apart from the edit above.
  delete before['src/auth/session.ts'];
  const after = snapshot(root);
  delete after['src/auth/session.ts'];
  assert.deepEqual(after, before);
});

test('deleted and added files and brand-new folders are reported', async (t) => {
  const root = await built(t);
  put(root, 'src/fresh/new.ts', 'export const added = 1;\n');
  const added = folderStatus(root);
  assert.deepEqual(added.new_folders, ['src/fresh']);
  assert.deepEqual(state(added, 'src').reasons, ['added']);
  assert.equal(state(added, 'src/billing').state, 'fresh');
  const fs = await import('node:fs');
  fs.rmSync(`${root}/src/billing/invoice.ts`);
  const both = folderStatus(root);
  assert.deepEqual(state(both, 'src/billing').reasons, ['deleted']);
  assert.deepEqual(state(both, 'src').reasons, ['added', 'deleted']);
});

test('missing and invalid context never claim per-folder freshness', async (t) => {
  const missing = folderStatus(fixture(t));
  assert.equal(missing.state, 'missing');
  assert.deepEqual(missing.folders, []);
  const root = await built(t);
  put(root, 'context/CONTEXT.md', 'corrupt');
  const invalid = folderStatus(root);
  assert.equal(invalid.state, 'invalid');
  assert.deepEqual(invalid.folders, []);
});

test('status CLI exits 0 when current and 1 when stale', async (t) => {
  const root = await built(t);
  const run = () =>
    spawnSync(process.execPath, [cli, 'status', root], { encoding: 'utf8' });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).state, 'current');
  put(root, 'src/auth/session.ts', 'export const changed = 1;\n');
  const stale = run();
  assert.equal(stale.status, 1);
  assert.equal(JSON.parse(stale.stdout).state, 'stale');
});
