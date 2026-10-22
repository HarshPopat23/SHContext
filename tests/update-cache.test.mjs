import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  baseline,
  fakeProvider,
  put,
  updateRepository,
  verifyRepository,
  paths,
  allPaths,
  olderComponent,
} from './helpers/update.mjs';
import { snapshot, readManifest } from './helpers/verification.mjs';

test('unchanged update uses no adapter or credentials and does not rewrite context bytes, names, or mtimes', async (t) => {
  const { root, bundle } = await baseline(t);
  const before = snapshot(root);
  const mtimes = readManifest(root).outputs.map(
    (item) => fs.statSync(join(root, item.path)).mtimeMs,
  );
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = '';
  t.after(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  });
  const result = await updateRepository(root);
  assert.equal(result.changed, false);
  assert.equal(result.model_calls, 0);
  assert.deepEqual(result.regenerated, []);
  assert.deepEqual(result.reused, allPaths(bundle));
  assert.deepEqual(result.changes, {
    added: [],
    modified: [],
    deleted: [],
    moves: [],
  });
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(
    readManifest(root).outputs.map(
      (item) => fs.statSync(join(root, item.path)).mtimeMs,
    ),
    mtimes,
  );
  const provider = fakeProvider(() => {
    throw Error('must not generate');
  });
  await updateRepository(root, { provider });
  assert.deepEqual(provider.calls, []);
  // Positive control: a source edit must invoke generation and publish a different snapshot.
  put(root, 'unrelated/info.ts', 'export const info = 2;\n');
  const positive = fakeProvider();
  assert.equal(
    (await updateRepository(root, { provider: positive })).changed,
    true,
  );
  assert.deepEqual(paths(positive), ['.', 'unrelated']);
  assert.notDeepEqual(snapshot(root), before);
});

for (const change of ['word-limit', 'model', 'exclusions', 'nested-ignore']) {
  test(`${change} changes invalidate the summary cache`, async (t) => {
    const { root, bundle } = await baseline(t);
    const config = JSON.parse(
      fs.readFileSync(join(root, 'shcontext.config.json'), 'utf8'),
    );
    const provider = fakeProvider();
    if (change === 'word-limit') config.folderWordLimit = 700;
    if (change === 'model') {
      config.provider.model = 'other-model';
      provider.identity.model = 'other-model';
    }
    if (change === 'exclusions')
      put(root, '.shcontextignore', '# changed policy\n');
    if (change === 'nested-ignore')
      put(root, 'src/.gitignore', '# changed policy\n');
    put(root, 'shcontext.config.json', JSON.stringify(config));
    const result = await updateRepository(root, { provider });
    assert.equal(result.changed, true);
    assert.deepEqual(result.reused, []);
    assert.deepEqual(paths(provider), allPaths(bundle));
    assert.equal(verifyRepository(root).state, 'fresh');
    const noop = await updateRepository(root);
    assert.equal(noop.changed, false);
  });
}
for (const component of [
  'generator',
  'parser',
  'resolver',
  'prompt',
  'template',
  'renderer',
]) {
  test(`recorded ${component} changes invalidate all summaries`, async (t) => {
    const { root, bundle } = await baseline(t);
    olderComponent(root, component);
    assert.equal(verifyRepository(root).state, 'stale');
    const provider = fakeProvider();
    const result = await updateRepository(root, { provider });
    assert.deepEqual(result.reused, []);
    assert.deepEqual(paths(provider), allPaths(bundle));
    assert.equal(verifyRepository(root).state, 'fresh');
  });
}

test('legacy owned context without structured cache is rebuilt once and then reusable', async (t) => {
  const { root } = await baseline(t);
  const manifest = readManifest(root);
  manifest.outputs = manifest.outputs.filter(
    (item) => item.path !== 'context/.shcontext/cache.json',
  );
  fs.rmSync(join(root, 'context/.shcontext/cache.json'));
  put(
    root,
    'context/.shcontext/manifest.json',
    JSON.stringify(manifest, null, 2) + '\n',
  );
  assert.equal(verifyRepository(root).state, 'fresh');
  const provider = fakeProvider();
  assert.equal((await updateRepository(root, { provider })).changed, true);
  assert.equal(provider.calls.length, 5);
  assert.equal((await updateRepository(root)).changed, false);
});

test('an ordinary directory without context can be initialized by update', async (t) => {
  const { fixture } = await import('./helpers/update.mjs');
  const root = fixture(t);
  const result = await updateRepository(root, { provider: fakeProvider() });
  assert.equal(result.changed, true);
  assert.equal(result.reused.length, 0);
  assert.equal(verifyRepository(root).state, 'fresh');
});

test('excluded bytes, binary size and timestamps do not trigger narrative generation', async (t) => {
  const { root } = await baseline(t);
  put(root, 'src/image.png', Buffer.from([0, 1, 2]));
  await updateRepository(root, { provider: fakeProvider() });
  const before = snapshot(join(root, 'context'));
  put(root, 'src/image.png', Buffer.from([0, 1, 2, 3, 4, 5]));
  put(root, 'src/.env', 'secret text stays excluded');
  // Adding an observed excluded path can refresh inventories once; later content edits do not.
  await updateRepository(root, { provider: fakeProvider() });
  const stable = snapshot(join(root, 'context'));
  put(root, 'src/.env', 'changed excluded content');
  put(root, 'src/image.png', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  fs.utimesSync(join(root, 'src/core/normalize.ts'), new Date(0), new Date(0));
  const provider = fakeProvider();
  const result = await updateRepository(root, { provider });
  assert.equal(result.changed, false);
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(snapshot(join(root, 'context')), stable);
  assert.notDeepEqual(before, stable);
});
