import { legacyOutput } from './helpers/verification.mjs';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildRepository,
  verifyRepository,
  validateContract,
} from '../dist/index.js';
import {
  built,
  fixture,
  fakeProvider,
  put,
  snapshot,
  denyRead,
  editOutput,
  readManifest,
  saveManifest,
} from './helpers/verification.mjs';
import { generationId } from '../dist/generation/summarize.js';

test('a build verifies fresh offline with no root state, credentials, model call or byte mutation', async (t) => {
  const { root } = await built(t);
  rmSync(join(root, '.shcontext'), { recursive: true });
  const before = snapshot(root);
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw Error('network forbidden');
  });
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
  const result = verifyRepository(root);
  assert.equal(result.state, 'fresh');
  assert.equal(result.coverage, 'complete');
  assert.equal(validateContract('verificationResult', result).success, true);
  assert.deepEqual(snapshot(root), before);
  assert.equal(fetch.mock.callCount(), 0);
});

test('unsupported text can verify fresh and partial; changing its bytes is stale', async (t) => {
  const { root } = await built(t, { partial: true });
  assert.deepEqual(
    [verifyRepository(root).state, verifyRepository(root).coverage],
    ['fresh', 'partial'],
  );
  put(root, 'src/legacy.py', 'other = 1');
  assert.equal(verifyRepository(root).state, 'stale');
});
for (const change of [
  'edit',
  'delete',
  'move',
  'new-file',
  'new-folder',
  'configuration',
  'ignore',
])
  test(`${change} makes existing context stale without rewriting it`, async (t) => {
    const { root } = await built(t);
    const before = snapshot(join(root, 'context'));
    if (change === 'edit')
      put(root, 'src/core/normalize.ts', 'export const modified=1;');
    if (change === 'delete') rmSync(join(root, 'src/core/normalize.ts'));
    if (change === 'move') {
      rmSync(join(root, 'src/core/normalize.ts'));
      put(root, 'src/moved.ts', 'export const moved=1;');
    }
    if (change === 'new-file') put(root, 'src/new.ts', 'export const fresh=1;');
    if (change === 'new-folder') mkdirSync(join(root, 'new-eligible'));
    if (change === 'configuration')
      put(
        root,
        'shcontext.config.json',
        JSON.stringify({
          version: 1,
          folderWordLimit: 700,
          provider: { id: 'openai', model: 'test-model' },
        }),
      );
    if (change === 'ignore') put(root, '.shcontextignore', 'src/core/\n');
    assert.equal(verifyRepository(root).state, 'stale');
    assert.deepEqual(snapshot(join(root, 'context')), before);
  });

test('timestamps and excluded content bytes do not determine freshness', async (t) => {
  const root = fixture(t);
  put(root, '.shcontextignore', 'ignored/\n');
  put(root, 'ignored/a.ts', 'one');
  put(root, 'binary.png', Buffer.from([0, 1]));
  await buildRepository(root, { provider: fakeProvider() });
  put(root, 'ignored/a.ts', 'different ignored bytes');
  put(root, 'binary.png', Buffer.alloc(400));
  utimesSync(join(root, 'src/api.ts'), new Date(0), new Date(0));
  assert.equal(verifyRepository(root).state, 'fresh');
});

test('a coherent older component identity is stale, and malformed identity is invalid', async (t) => {
  const { root } = await built(t);
  legacyOutput(root);
  const manifest = readManifest(root),
    old = manifest.generator.generation_id;
  manifest.generation.generator = 'older-version';
  manifest.generator.version = 'older-version';
  manifest.generator.generation_id = generationId(manifest.generation);
  for (const output of manifest.outputs.filter((item) =>
    item.path.endsWith('CONTEXT.md'),
  ))
    editOutput(root, output.path, (text) =>
      text.replaceAll(old, manifest.generator.generation_id),
    );
  const changed = readManifest(root);
  manifest.outputs = changed.outputs;
  saveManifest(root, manifest);
  assert.equal(verifyRepository(root).state, 'stale');
  manifest.generator.generation_id = 'sha256:' + 'f'.repeat(64);
  saveManifest(root, manifest);
  assert.equal(verifyRepository(root).state, 'invalid');
});

test('losing access to a formerly readable file is unknown; a separate known change takes precedence', async (t) => {
  const { root } = await built(t);
  denyRead(t, join(root, 'src/core/normalize.ts'));
  const result = verifyRepository(root);
  assert.equal(result.state, 'unknown');
  assert.ok(result.findings.some((f) => f.code === 'input_unreadable'));
  put(root, 'src/new.ts', 'export const added=1;');
  assert.equal(verifyRepository(root).state, 'stale');
});

test('unreadable selection controls prevent comparison and do not become absence', async (t) => {
  const { root } = await built(t);
  denyRead(t, join(root, 'shcontext.config.json'));
  assert.equal(verifyRepository(root).state, 'unknown');
});

test('known source changes take precedence over uncertainty, and output corruption takes precedence over both', async (t) => {
  const { root } = await built(t);
  put(root, 'src/core/normalize.ts', 'export const shorter=1;');
  assert.equal(verifyRepository(root).state, 'stale'); // old end_line bounds are not checked against different bytes
  put(root, 'context/CONTEXT.md', 'malformed');
  assert.equal(verifyRepository(root).state, 'invalid');
});

test('unreadable content recorded by a partial build remains unknown when still unreadable', async (t) => {
  const root = fixture(t);
  denyRead(t, join(root, 'src/core/normalize.ts'));
  await buildRepository(root, { provider: fakeProvider() });
  const result = verifyRepository(root);
  assert.equal(result.state, 'unknown');
  assert.equal(result.coverage, 'partial');
});

test('missing output is invalid and an unavailable root is unknown', (t) => {
  const root = fixture(t);
  assert.equal(verifyRepository(root).state, 'invalid');
  assert.equal(verifyRepository(join(root, 'absent')).state, 'unknown');
});

test('an unreadable directory masks unknown descendants and nested controls instead of implying deletion', async (t) => {
  const fs = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const root = fixture(t);
  put(root, 'src/core/.gitignore', 'temporary/\n');
  await buildRepository(root, { provider: fakeProvider() });
  const original = fs.default.opendirSync;
  const mock = t.mock.method(
    fs.default,
    'opendirSync',
    function (path, ...args) {
      if (String(path) === join(root, 'src/core')) {
        const error = Error('denied');
        error.code = 'EACCES';
        throw error;
      }
      return original.call(this, path, ...args);
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  const result = verifyRepository(root);
  assert.equal(result.state, 'unknown');
  assert.equal(
    result.findings.some((f) => f.code === 'selection_changed'),
    false,
  );
});
