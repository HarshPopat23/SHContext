import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { buildRepository, validateContract } from '../dist/index.js';
import {
  baseline,
  changed,
  fixture,
  put,
  fakeProvider,
  paths,
  updateRepository,
} from './helpers/update.mjs';
import { readManifest } from './helpers/verification.mjs';

test('isolated edit regenerates only its folder and root, retaining other prose exactly', async (t) => {
  const { root, bundle } = await baseline(t);
  put(root, 'unrelated/info.ts', 'export const info=2;\n');
  const result = await changed(root, ['unrelated', '.']);
  assert.deepEqual(result.changes.modified, ['unrelated/info.ts']);
  assert.deepEqual(result.reused, ['src', 'src/core', 'tests']);
  for (const path of result.reused) {
    const before = bundle.folders.find((f) => f.source_path === path),
      after = result.bundle.folders.find((f) => f.source_path === path);
    assert.deepEqual(after.purpose, before.purpose);
    assert.deepEqual(after.files, before.files);
  }
});
test('target edit refreshes dependent consumers and ancestors, without touching unrelated summaries', async (t) => {
  const { root } = await baseline(t);
  put(
    root,
    'src/core/normalize.ts',
    'export function normalize(value:string){return value.toLowerCase();}\n',
  );
  const result = await changed(root, ['src/core', 'src', 'tests', '.']);
  assert.deepEqual(result.reused, ['unrelated']);
});
test('incoming consumer evidence change refreshes the target folder and ancestors', async (t) => {
  const { root } = await baseline(t);
  put(
    root,
    'tests/normalize.test.ts',
    "import {normalize} from '../src/core/normalize';\nexport const check = normalize('Z');\n",
  );
  await changed(root, ['tests', 'src/core', 'src', '.']);
});
test('new earlier-sorted source rebases citation IDs without regenerating unrelated folders', async (t) => {
  const { root } = await baseline(t);
  put(root, 'aaa/new.ts', 'export const added=1;\n');
  const result = await changed(root, ['aaa', '.']);
  assert.deepEqual(result.changes.added, ['aaa/new.ts']);
  assert.equal(validateContract('bundle', result.bundle).success, true);
  assert.equal((await updateRepository(root)).changed, false);
});
test('new direct file refreshes its folder and parents, preserving unaffected consumers', async (t) => {
  const { root } = await baseline(t);
  put(root, 'src/core/added.ts', 'export const added=1;\n');
  await changed(root, ['src/core', 'src', '.']);
});
test('deleted folder removes only obsolete owned summaries and refreshes parents', async (t) => {
  const { root } = await baseline(t);
  fs.rmSync(join(root, 'unrelated'), { recursive: true });
  const result = await changed(root, ['.']);
  assert.deepEqual(result.changes.deleted, ['unrelated/info.ts']);
  assert.equal(fs.existsSync(join(root, 'context/unrelated')), false);
  assert.ok(
    !readManifest(root).outputs.some((item) =>
      item.path.includes('/unrelated/'),
    ),
  );
});
test('same-content move is detected in an ordinary directory, with both old and new ancestry refreshed', async (t) => {
  const { root } = await baseline(t);
  fs.mkdirSync(join(root, 'archive'));
  fs.renameSync(join(root, 'unrelated/info.ts'), join(root, 'archive/info.ts'));
  fs.rmdirSync(join(root, 'unrelated'));
  const result = await changed(root, ['archive', '.']);
  assert.deepEqual(result.changes.moves, [
    {
      from: 'unrelated/info.ts',
      to: 'archive/info.ts',
      basis: 'identical-content',
    },
  ]);
  assert.equal(fs.existsSync(join(root, 'context/unrelated')), false);
});
test('duplicate content produces additions/deletions without inventing a unique move', async (t) => {
  const root = fixture(t, { sources: false });
  put(root, 'old/a.ts', 'export const same=1;');
  put(root, 'old/b.ts', 'export const same=1;');
  await buildRepository(root, { provider: fakeProvider() });
  fs.renameSync(join(root, 'old'), join(root, 'new'));
  const result = await changed(root, ['new', '.']);
  assert.deepEqual(result.changes.moves, []);
  assert.equal(result.changes.added.length, 2);
  assert.equal(result.changes.deleted.length, 2);
});
test('new candidate changes unresolved to resolved and ambiguous resolution without model-selected edges', async (t) => {
  const { root } = await baseline(t);
  put(root, 'src/missing.ts', 'export default 1;\n');
  let result = await changed(root, ['src', '.']);
  assert.ok(
    result.bundle.edges.some(
      (edge) =>
        edge.reference.specifier === './missing' &&
        edge.resolution === 'resolved',
    ),
  );
  put(root, 'src/missing.js', 'export default 2;\n');
  result = await changed(root, ['src', '.']);
  assert.ok(
    result.bundle.edges.some(
      (edge) =>
        edge.reference.specifier === './missing' &&
        edge.resolution === 'unresolved' &&
        edge.reason === 'ambiguous',
    ),
  );
});
test('deleted dependency refreshes the former consumer and target ancestry while retaining unresolved status', async (t) => {
  const { root } = await baseline(t);
  fs.rmSync(join(root, 'src/core/normalize.ts'));
  fs.rmdirSync(join(root, 'src/core'));
  const result = await changed(root, ['src', 'tests', '.']);
  assert.ok(
    result.bundle.edges.some(
      (edge) =>
        edge.reference.specifier === './core/normalize' &&
        edge.resolution === 'unresolved',
    ),
  );
});
test('unsupported and empty file edits update mechanical context without provider calls for those leaf folders', async (t) => {
  const root = fixture(t, { sources: false });
  put(root, 'unknown/file.py', 'VALUE=1');
  put(root, 'empty/file.ts', '');
  await buildRepository(root, { provider: fakeProvider() });
  put(root, 'unknown/file.py', 'VALUE=2');
  const provider = fakeProvider();
  const result = await updateRepository(root, { provider });
  assert.deepEqual(paths(provider), ['.']);
  assert.deepEqual(result.regenerated, ['.', 'unknown']);
  assert.deepEqual(result.reused, ['empty']);
  assert.equal(result.bundle.inventory.coverage, 'partial');
});
test('cyclic imports terminate and refresh changed graph descriptions', async (t) => {
  const root = fixture(t, { sources: false });
  put(root, 'a/file.ts', "import '../b/file'; export const a=1;\n");
  put(root, 'b/file.ts', "import '../a/file'; export const b=1;\n");
  await buildRepository(root, { provider: fakeProvider() });
  put(root, 'a/file.ts', "import '../b/missing'; export const a=2;\n");
  await changed(root, ['a', 'b', '.']);
});
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
test('available Git rename hints supplement hashes for staged moves with edits and do not mutate the index', async (t) => {
  const root = fixture(t, { sources: false });
  put(
    root,
    'old/file.ts',
    Array.from({ length: 20 }, (_, i) => `export const value${i}=${i};`).join(
      '\n',
    ) + '\n',
  );
  git(root, ['init']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    `core.hooksPath=${join(root, 'empty-hooks')}`,
    'commit',
    '-m',
    'baseline',
  ]);
  await buildRepository(root, { provider: fakeProvider() });
  fs.renameSync(join(root, 'old'), join(root, 'new'));
  fs.appendFileSync(join(root, 'new/file.ts'), 'export const extra=1;\n');
  git(root, ['add', 'old', 'new']);
  const before = git(root, ['ls-files', '--stage']);
  const result = await changed(root, ['new', '.']);
  assert.deepEqual(result.changes.moves, [
    { from: 'old/file.ts', to: 'new/file.ts', basis: 'git-rename-hint' },
  ]);
  assert.equal(git(root, ['ls-files', '--stage']), before);
  assert.match(readManifest(root).provenance.git_head, /^[0-9a-f]{40,64}$/);
});

test('Git HEAD changes alone do not invalidate content or require credentials', async (t) => {
  const root = fixture(t);
  git(root, ['init']);
  git(root, ['add', '.']);
  const commit = [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    `core.hooksPath=${join(root, 'empty-hooks')}`,
    'commit',
  ];
  git(root, [...commit, '-m', 'baseline']);
  const { bundle } = await buildRepository(root, { provider: fakeProvider() });
  git(root, [...commit, '--allow-empty', '-m', 'provenance only']);
  assert.notEqual(
    git(root, ['rev-parse', 'HEAD']),
    bundle.manifest.provenance.git_head,
  );
  const provider = fakeProvider();
  const result = await updateRepository(root, { provider });
  assert.equal(result.changed, false);
  assert.deepEqual(provider.calls, []);
  assert.equal(
    readManifest(root).provenance.git_head,
    bundle.manifest.provenance.git_head,
  );
});
