import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import {
  baseline,
  put,
  fakeProvider,
  updateRepository,
  verifyRepository,
  rewriteCache,
} from './helpers/update.mjs';
import {
  snapshot,
  hash,
  readManifest,
  saveManifest,
  denyRead,
} from './helpers/verification.mjs';
import { inspectOwnedTree } from '../dist/storage/publication.js';
const context = (root) => snapshot(join(root, 'context'));

for (const corruption of [
  'missing',
  'bytes',
  'malformed-rehashed',
  'wrong-snapshot',
  'different-prose',
  'missing-folder',
  'duplicate-key',
]) {
  test(`update rejects ${corruption} cache before model work and preserves output`, async (t) => {
    const { root } = await baseline(t);
    const cachePath = 'context/.shcontext/cache.json';
    if (corruption === 'missing') fs.rmSync(join(root, cachePath));
    if (corruption === 'bytes') fs.appendFileSync(join(root, cachePath), ' ');
    if (corruption === 'malformed-rehashed') {
      put(root, cachePath, '{}');
      const manifest = readManifest(root);
      manifest.outputs.find((item) => item.path === cachePath).sha256 =
        hash('{}');
      saveManifest(root, manifest);
    }
    if (corruption === 'wrong-snapshot')
      rewriteCache(root, (cache) => {
        cache.input_id = 'sha256:' + '0'.repeat(64);
      });
    if (corruption === 'different-prose')
      rewriteCache(root, (cache) => {
        cache.folders[0].summary.purpose[0].text = 'Different prose.';
      });
    if (corruption === 'missing-folder')
      rewriteCache(root, (cache) => {
        cache.folders.pop();
      });
    if (corruption === 'duplicate-key') {
      const bytes = fs
        .readFileSync(join(root, cachePath), 'utf8')
        .replace('"version": 1', '"version": 1, "version": 1');
      put(root, cachePath, bytes);
      const manifest = readManifest(root);
      manifest.outputs.find((item) => item.path === cachePath).sha256 =
        hash(bytes);
      saveManifest(root, manifest);
    }
    const before = context(root),
      provider = fakeProvider();
    await assert.rejects(
      updateRepository(root, { provider }),
      (e) => e.code === 'output_ownership',
    );
    assert.deepEqual(provider.calls, []);
    assert.deepEqual(context(root), before);
    assert.equal(verifyRepository(root).state, 'invalid');
  });
}
test('a changed cache key triggers generation rather than silently accepting a stale hit', async (t) => {
  const { root } = await baseline(t);
  rewriteCache(root, (cache) => {
    cache.folders.find(
      (item) => item.summary.source_path === 'unrelated',
    ).input_hash = 'sha256:' + '0'.repeat(64);
  });
  const provider = fakeProvider();
  const result = await updateRepository(root, { provider });
  assert.deepEqual(result.regenerated, ['unrelated']);
  assert.deepEqual(
    provider.calls.map((call) => call.input.source_path),
    ['unrelated'],
  );
  assert.equal(verifyRepository(root).state, 'fresh');
});
for (const obstacle of ['extra-file', 'edited-summary', 'hardlinked-cache']) {
  test(`obsolete generated folder with ${obstacle} is preserved without generation`, async (t) => {
    const { root } = await baseline(t);
    fs.rmSync(join(root, 'unrelated'), { recursive: true });
    if (obstacle === 'extra-file')
      put(root, 'context/unrelated/notes.md', 'user notes');
    if (obstacle === 'edited-summary')
      fs.appendFileSync(
        join(root, 'context/unrelated/CONTEXT.md'),
        'user note',
      );
    if (obstacle === 'hardlinked-cache')
      fs.linkSync(
        join(root, 'context/.shcontext/cache.json'),
        join(root, 'keep-cache.json'),
      );
    const before = context(root),
      provider = fakeProvider();
    await assert.rejects(
      updateRepository(root, { provider }),
      (e) => e.code === 'output_ownership',
    );
    assert.deepEqual(provider.calls, []);
    assert.deepEqual(context(root), before);
    assert.ok(fs.existsSync(join(root, 'context/unrelated/CONTEXT.md')));
  });
}
for (const failure of [
  'source-change',
  'provider-failure',
  'cancel',
  'invalid-draft',
]) {
  test(`${failure} during update retains the complete previous context`, async (t) => {
    const { root } = await baseline(t);
    put(root, 'unrelated/info.ts', 'export const changed=2;');
    const before = context(root),
      controller = new AbortController();
    const provider = fakeProvider((draft) => {
      if (failure === 'source-change')
        put(root, 'unrelated/info.ts', 'export const racing=3;');
      if (failure === 'provider-failure') throw Error('provider failure');
      if (failure === 'cancel') controller.abort();
      if (failure === 'invalid-draft')
        draft.purpose[0].evidence_ids = ['E999999'];
      return draft;
    });
    await assert.rejects(
      updateRepository(root, { provider, signal: controller.signal }),
    );
    assert.deepEqual(context(root), before);
    assert.deepEqual(fs.readdirSync(join(root, '.shcontext')), []);
  });
}
test('source change while staging is detected before swap and discards the staged tree', async (t) => {
  const { root } = await baseline(t);
  put(root, 'unrelated/info.ts', 'export const changed=2;');
  const before = context(root),
    original = fs.writeFileSync;
  let injected = false;
  const mock = t.mock.method(fs, 'writeFileSync', function (path, ...args) {
    const result = original.call(this, path, ...args);
    if (
      !injected &&
      String(path).includes('stage-') &&
      String(path).endsWith('manifest.json')
    ) {
      injected = true;
      put(root, 'unrelated/info.ts', 'export const racing=3;');
    }
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  await assert.rejects(
    updateRepository(root, { provider: fakeProvider() }),
    (e) => e.code === 'source_changed',
  );
  assert.equal(injected, true);
  assert.deepEqual(context(root), before);
  assert.deepEqual(fs.readdirSync(join(root, '.shcontext')), []);
});
test('concurrent updates cannot publish through the same live writer', async (t) => {
  const { root } = await baseline(t);
  put(root, 'unrelated/info.ts', 'export const changed=2;');
  let entered, resume;
  const start = new Promise((resolve) => {
      entered = resolve;
    }),
    pending = new Promise((resolve) => {
      resume = resolve;
    });
  const provider = fakeProvider(async (draft) => {
    entered();
    await pending;
    return draft;
  });
  const first = updateRepository(root, { provider });
  await start;
  try {
    await assert.rejects(
      updateRepository(root, { provider: fakeProvider() }),
      (e) => e.code === 'build_locked',
    );
  } finally {
    resume();
  }
  await first;
  assert.equal(verifyRepository(root).state, 'fresh');
});
for (const phase of ['prepared', 'backed-up', 'installed', 'validated']) {
  test(`update recovers journal-owned ${phase} publication and then reuses summaries`, async (t) => {
    const { root } = await baseline(t);
    const identity = inspectOwnedTree(root),
      token = randomUUID(),
      state = join(root, '.shcontext');
    const stage = join(state, `stage-${token}`),
      backup = join(state, `backup-${token}`),
      tree = join(root, 'context');
    fs.cpSync(tree, stage, { recursive: true });
    if (phase !== 'prepared') fs.renameSync(tree, backup);
    if (['installed', 'validated'].includes(phase)) fs.renameSync(stage, tree);
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
    const provider = fakeProvider();
    const result = await updateRepository(root, { provider });
    assert.equal(result.changed, false);
    assert.deepEqual(provider.calls, []);
    assert.equal(inspectOwnedTree(root), identity);
    assert.deepEqual(fs.readdirSync(state), []);
    assert.equal(verifyRepository(root).state, 'fresh');
  });
}
test('unreadable source is reported as partial and unknown instead of a false fresh promise', async (t) => {
  const { root } = await baseline(t);
  denyRead(t, join(root, 'unrelated/info.ts'));
  const result = await updateRepository(root, { provider: fakeProvider() });
  assert.equal(result.bundle.inventory.coverage, 'partial');
  assert.equal(verifyRepository(root).state, 'unknown');
});
