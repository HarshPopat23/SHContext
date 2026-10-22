import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  renameSync,
  mkdirSync,
  symlinkSync,
  linkSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildRepository } from '../dist/index.js';
import {
  inspectOwnedTree,
  recoverPublication,
  withPublicationLock,
} from '../dist/storage/publication.js';
import { fixture, put, fakeProvider } from './helpers/generation.mjs';
const output = (root) => readFileSync(join(root, 'context/CONTEXT.md'), 'utf8');

test('owned output rebuilds, stale source can rebuild and output edits block before provider calls', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: fakeProvider() });
  const first = inspectOwnedTree(root);
  await buildRepository(root, { provider: fakeProvider() });
  assert.equal(inspectOwnedTree(root), first);
  put(
    root,
    'src/core/normalize.ts',
    'export function normalize(s: string) { return s.trim(); }',
  );
  await buildRepository(root, { provider: fakeProvider() });
  assert.notEqual(inspectOwnedTree(root), first);
  writeFileSync(join(root, 'context/CONTEXT.md'), 'user notes');
  const p = fakeProvider();
  await assert.rejects(
    buildRepository(root, { provider: p }),
    (e) => e.code === 'output_ownership',
  );
  assert.equal(p.calls.length, 0);
  assert.equal(output(root), 'user notes');
});
for (const kind of [
  'unowned',
  'unexpected-file',
  'unexpected-directory',
  'hardlink',
  'missing-output',
  'corrupt-manifest',
])
  test(`replacement rejects ${kind} without damaging output`, async (t) => {
    const root = fixture(t);
    if (kind === 'unowned') put(root, 'context/notes.txt', 'user content');
    else {
      await buildRepository(root, { provider: fakeProvider() });
      if (kind === 'unexpected-file')
        put(root, 'context/notes.txt', 'user content');
      if (kind === 'unexpected-directory')
        mkdirSync(join(root, 'context/notes'));
      if (kind === 'hardlink') {
        rmSync(join(root, 'context/src/CONTEXT.md'));
        linkSync(
          join(root, 'context/CONTEXT.md'),
          join(root, 'context/src/CONTEXT.md'),
        );
      }
      if (kind === 'missing-output')
        rmSync(join(root, 'context/src/CONTEXT.md'));
      if (kind === 'corrupt-manifest')
        put(root, 'context/.shcontext/manifest.json', '{"schema_version":99}');
    }
    const p = fakeProvider();
    await assert.rejects(
      buildRepository(root, { provider: p }),
      (e) => e.code === 'output_ownership',
    );
    assert.equal(p.calls.length, 0);
  });
test('output symlinks are refused and their targets remain untouched', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: fakeProvider() });
  put(root, 'outside.txt', 'preserve');
  rmSync(join(root, 'context/src/CONTEXT.md'));
  try {
    symlinkSync(
      join(root, 'outside.txt'),
      join(root, 'context/src/CONTEXT.md'),
    );
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('symlink privilege unavailable');
      return;
    }
    throw error;
  }
  await assert.rejects(
    buildRepository(root, { provider: fakeProvider() }),
    (e) => e.code === 'output_ownership',
  );
  assert.equal(readFileSync(join(root, 'outside.txt'), 'utf8'), 'preserve');
});
test('source mutation, provider failure and cancellation leave previous output intact', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: fakeProvider() });
  const before = output(root);
  const changing = fakeProvider((draft, input, request, count) => {
    if (count === 1)
      put(root, 'src/core/normalize.ts', 'export const changed = 1;');
    return draft;
  });
  await assert.rejects(
    buildRepository(root, { provider: changing }),
    (e) => e.code === 'source_changed',
  );
  assert.equal(output(root), before);
  const failing = fakeProvider(() => {
    throw Error('arbitrary provider failure');
  });
  await assert.rejects(buildRepository(root, { provider: failing }));
  assert.equal(output(root), before);
  const controller = new AbortController(),
    cancelling = fakeProvider((draft) => {
      controller.abort();
      return draft;
    });
  await assert.rejects(
    buildRepository(root, { provider: cancelling, signal: controller.signal }),
    (e) => e.code === 'cancelled',
  );
  assert.equal(output(root), before);
});
test('concurrent builds do not share a writer; live lock is preserved', async (t) => {
  const root = fixture(t);
  let resume;
  const wait = new Promise((resolve) => {
    resume = resolve;
  });
  let started;
  const start = new Promise((resolve) => {
    started = resolve;
  });
  const p = fakeProvider(async (draft, input, request, count) => {
    if (count === 1) {
      started();
      await wait;
    }
    return draft;
  });
  const building = buildRepository(root, { provider: p });
  await start;
  try {
    await assert.rejects(
      buildRepository(root, { provider: fakeProvider() }),
      (e) => e.code === 'build_locked',
    );
    assert.ok(readdirSync(join(root, '.shcontext')).includes('build.lock'));
  } finally {
    resume();
  }
  await building;
});
for (const phase of ['staged', 'backed-up', 'installed', 'validated'])
  test(`interrupted ${phase} publication recovers the correct owned tree`, async (t) => {
    const root = fixture(t);
    await buildRepository(root, { provider: fakeProvider() });
    const old = inspectOwnedTree(root);
    // A second valid tree is the pending new generation, with a distinct source identity.
    const oldBytes = new Map();
    function remember(dir, rel = '') {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = rel ? `${rel}/${name.name}` : name.name;
        if (name.isDirectory()) remember(join(dir, name.name), path);
        else oldBytes.set(path, readFileSync(join(dir, name.name)));
      }
    }
    remember(join(root, 'context'));
    put(root, 'src/new.ts', 'export const newlyAdded = true;');
    await buildRepository(root, { provider: fakeProvider() });
    const next = inspectOwnedTree(root);
    const token = randomUUID(),
      state = join(root, '.shcontext'),
      stage = join(state, `stage-${token}`),
      backup = join(state, `backup-${token}`);
    renameSync(join(root, 'context'), stage);
    for (const [path, bytes] of oldBytes) put(root, `context/${path}`, bytes);
    if (phase !== 'staged') renameSync(join(root, 'context'), backup);
    if (['installed', 'validated'].includes(phase))
      renameSync(stage, join(root, 'context'));
    put(
      root,
      '.shcontext/journal.json',
      JSON.stringify({
        version: 1,
        token,
        phase: phase === 'validated' ? 'validated' : 'pending',
        old,
        next,
      }),
    );
    await withPublicationLock(root, async () => {});
    assert.equal(inspectOwnedTree(root), phase === 'validated' ? next : old);
    assert.deepEqual(readdirSync(state), []);
  });
test('first-build interrupted installation rolls back without deleting unowned additions', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: fakeProvider() });
  const next = inspectOwnedTree(root),
    token = randomUUID();
  put(
    root,
    '.shcontext/journal.json',
    JSON.stringify({ version: 1, token, phase: 'pending', old: null, next }),
  );
  put(root, 'context/user-notes.txt', 'preserve');
  assert.throws(
    () => recoverPublication(root),
    (e) => e.code === 'output_ownership',
  );
  assert.equal(
    readFileSync(join(root, 'context/user-notes.txt'), 'utf8'),
    'preserve',
  );
  rmSync(join(root, 'context/user-notes.txt'));
  recoverPublication(root);
  assert.ok(!readdirSync(root).includes('context'));
});
test('unrecognized state, malformed journal and path injection block without cleanup', async (t) => {
  const root = fixture(t);
  put(root, '.shcontext/notes.txt', 'preserve');
  await assert.rejects(
    buildRepository(root, { provider: fakeProvider() }),
    (e) => e.code === 'output_ownership',
  );
  assert.equal(
    readFileSync(join(root, '.shcontext/notes.txt'), 'utf8'),
    'preserve',
  );
  rmSync(join(root, '.shcontext/notes.txt'));
  put(
    root,
    '.shcontext/journal.json',
    JSON.stringify({
      version: 1,
      token: '../../escape',
      phase: 'pending',
      old: null,
      next: 'bad',
    }),
  );
  await assert.rejects(
    buildRepository(root, { provider: fakeProvider() }),
    (e) => e.code === 'output_ownership',
  );
  assert.ok(readdirSync(join(root, '.shcontext')).includes('journal.json'));
});

test('cleanup interrupted after deleting backup files resumes under a validated journal', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: fakeProvider() });
  const identity = inspectOwnedTree(root),
    token = randomUUID();
  const backup = join(root, `.shcontext/backup-${token}`);
  const { cpSync } = await import('node:fs');
  cpSync(join(root, 'context'), backup, { recursive: true });
  put(
    root,
    '.shcontext/journal.json',
    JSON.stringify({
      version: 1,
      token,
      phase: 'validated',
      old: identity,
      next: identity,
    }),
  );
  rmSync(join(backup, 'src/CONTEXT.md'));
  await withPublicationLock(root, async () => {});
  assert.equal(inspectOwnedTree(root), identity);
  assert.deepEqual(readdirSync(join(root, '.shcontext')), []);
});

test('interrupted lock claim blocks for manual inspection instead of stealing it', async (t) => {
  const root = fixture(t);
  put(root, '.shcontext/claim.lock', 'unfinished-claim');
  await assert.rejects(
    buildRepository(root, { provider: fakeProvider() }),
    (e) => e.code === 'build_locked',
  );
  assert.equal(
    readFileSync(join(root, '.shcontext/claim.lock'), 'utf8'),
    'unfinished-claim',
  );
});

test('an existing empty context directory can be initialized', async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'context'));
  await buildRepository(root, { provider: fakeProvider() });
  assert.ok(inspectOwnedTree(root));
});
