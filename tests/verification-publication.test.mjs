import assert from 'node:assert/strict';
import { cpSync, renameSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  buildRepository,
  verifyRepository,
  BuildError,
} from '../dist/index.js';
import {
  inspectOwnedTree,
  withPublicationLock,
  publish,
} from '../dist/storage/publication.js';
import {
  built,
  put,
  fakeProvider,
  snapshot,
  readManifest,
  hash,
} from './helpers/verification.mjs';

for (const phase of ['prepared', 'backed-up', 'installed', 'validated'])
  test(`verify is read-only invalid for interrupted ${phase} publication; build recovers it`, async (t) => {
    const { root } = await built(t),
      identity = inspectOwnedTree(root),
      token = randomUUID();
    const state = join(root, '.shcontext'),
      stage = join(state, `stage-${token}`),
      backup = join(state, `backup-${token}`),
      context = join(root, 'context');
    cpSync(context, stage, { recursive: true });
    if (phase !== 'prepared') renameSync(context, backup);
    if (['installed', 'validated'].includes(phase)) renameSync(stage, context);
    put(
      root,
      '.shcontext/journal.json',
      JSON.stringify({
        version: 1,
        token,
        phase: phase === 'validated' ? 'validated' : 'pending',
        old: identity,
        next: identity,
      }),
    );
    const before = snapshot(root);
    assert.equal(verifyRepository(root).state, 'invalid');
    assert.deepEqual(
      snapshot(root),
      before,
      'verify never repairs a transaction',
    );
    await buildRepository(root, { provider: fakeProvider() });
    assert.equal(verifyRepository(root).state, 'fresh');
    assert.deepEqual(readdirSync(state), []);
  });

for (const file of ['build.lock', 'claim.lock', 'journal.tmp', 'unknown-note'])
  test(`verify rejects ${file} operational state without changing it`, async (t) => {
    const { root } = await built(t);
    put(root, `.shcontext/${file}`, 'preserve');
    const before = snapshot(root);
    assert.equal(verifyRepository(root).state, 'invalid');
    assert.deepEqual(snapshot(root), before);
  });

test('verify reports active generation invalid; the completed build is fresh', async (t) => {
  const { root } = await built(t);
  let resume, entered;
  const pending = new Promise((r) => {
      resume = r;
    }),
    started = new Promise((r) => {
      entered = r;
    });
  const provider = fakeProvider(async (draft, input, request, count) => {
    if (count === 1) {
      entered();
      await pending;
    }
    return draft;
  });
  const building = buildRepository(root, { provider });
  await started;
  try {
    assert.equal(verifyRepository(root).state, 'invalid');
  } finally {
    resume();
  }
  await building;
  assert.equal(verifyRepository(root).state, 'fresh');
});

test('staged malformed Markdown is rejected before swapping a complete existing tree', async (t) => {
  const { root } = await built(t);
  const manifest = readManifest(root);
  const outputs = new Map(
    manifest.outputs.map((o) => [
      o.path,
      readFileSync(join(root, o.path), 'utf8'),
    ]),
  );
  const path = 'context/CONTEXT.md',
    text = outputs.get(path).replace('## Evidence', '## Broken');
  outputs.set(path, text);
  manifest.outputs.find((o) => o.path === path).sha256 = hash(text);
  outputs.set(
    'context/.shcontext/manifest.json',
    JSON.stringify(manifest, null, 2) + '\n',
  );
  const before = snapshot(join(root, 'context'));
  let beforeSwap = false;
  await assert.rejects(
    withPublicationLock(root, async (initial) =>
      publish(root, outputs, initial, () => {
        beforeSwap = true;
      }),
    ),
  );
  assert.equal(beforeSwap, false);
  assert.deepEqual(snapshot(join(root, 'context')), before);
  assert.equal(verifyRepository(root).state, 'fresh');
});

test('source recheck failure immediately before swap removes staged drafts and preserves output', async (t) => {
  const { root } = await built(t);
  const manifest = readManifest(root);
  const outputs = new Map(
    [
      ...manifest.outputs.map((o) => o.path),
      'context/.shcontext/manifest.json',
    ].map((path) => [path, readFileSync(join(root, path), 'utf8')]),
  );
  const before = snapshot(join(root, 'context'));
  await assert.rejects(
    withPublicationLock(root, async (initial) =>
      publish(root, outputs, initial, () => {
        throw new BuildError(
          'source_changed',
          'Source changed before publication.',
        );
      }),
    ),
    (e) => e.code === 'source_changed',
  );
  assert.deepEqual(snapshot(join(root, 'context')), before);
  assert.deepEqual(readdirSync(join(root, '.shcontext')), []);
});

test('malformed or unowned interrupted state stays invalid and preserves user files', async (t) => {
  const { root } = await built(t);
  put(root, '.shcontext/journal.json', 'malformed');
  put(root, '.shcontext/user-notes', 'preserve');
  const before = snapshot(root);
  assert.equal(verifyRepository(root).state, 'invalid');
  await assert.rejects(buildRepository(root, { provider: fakeProvider() }));
  assert.deepEqual(snapshot(root), before);
});

test('non-UTF8 output remains invalid even when its bytes are rehashed', async (t) => {
  const { root } = await built(t);
  const manifest = readManifest(root),
    bytes = Buffer.from([255]);
  put(root, 'context/CONTEXT.md', bytes);
  manifest.outputs.find((o) => o.path === 'context/CONTEXT.md').sha256 =
    hash(bytes);
  put(root, 'context/.shcontext/manifest.json', JSON.stringify(manifest));
  assert.equal(verifyRepository(root).state, 'invalid');
});
