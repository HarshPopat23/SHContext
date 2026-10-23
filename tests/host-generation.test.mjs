import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  prepareRepository,
  finalizeRepository,
  verifyRepository,
  queryRepository,
  buildRepository,
} from '../dist/index.js';
import {
  hostFixture,
  complete,
  readRequest,
  readState,
  snapshot,
  put,
} from './helpers/host.mjs';

test('host build is sequential, source-bound and unpublished until finalize without an API key or network', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw Error('Network must not run');
  });
  const { root, session } = hostFixture(t),
    before = snapshot(root);
  const { result, requests } = await complete(root, session);
  assert.equal(result.status, 'ready');
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(
    requests.map((r) => r.source_path),
    ['auth', 'routes', 'unrelated', '.'],
  );
  assert.ok(
    requests.at(-1).input.children.every((child) => child.purpose.length),
  );
  assert.ok(
    requests
      .at(-1)
      .input.dependencies.some((x) =>
        x.text.includes('cross-folder reference'),
      ),
  );
  const built = await finalizeRepository(root, session);
  assert.equal(built.status, 'published');
  assert.equal(built.host_drafts, 4);
  assert.equal(built.actual_host_tokens, null);
  assert.equal(built.actual_host_cost_usd, null);
  assert.equal(verifyRepository(root).state, 'fresh');
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'context/.shcontext/manifest.json')),
  );
  assert.deepEqual(manifest.generation.provider, {
    id: 'host',
    model: 'claude-code-session',
  });
  assert.match(manifest.generation.prompt, /host-v1/);
  const query = queryRepository(root, 'verifySession');
  assert.ok(query.matches.some((x) => x.path === 'auth/session.ts'));
  assert.ok(
    query.matches
      .flatMap((x) => x.references)
      .every((ref) => ref.sha256.startsWith('sha256:')),
  );
  await assert.rejects(
    buildRepository(root),
    (e) => e.code === 'host_workflow_required',
  );
});
test('host update reuses unchanged summaries, refreshes dependent folders, removes only obsolete owned outputs and ends fresh', async (t) => {
  const { root, box, session } = hostFixture(t);
  await complete(root, session);
  await finalizeRepository(root, session);
  const before = snapshot(join(root, 'context'));
  const noOp = join(box, 'noop');
  const ready = await prepareRepository(root, noOp, { update: true });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.host_drafts, 0);
  const unchanged = await finalizeRepository(root, noOp);
  assert.equal(unchanged.changed, false);
  assert.deepEqual(snapshot(join(root, 'context')), before);
  put(
    root,
    'auth/session.ts',
    'export function verifySession(token: string) { return token.startsWith("signed:") && token.length > 7; }\n',
  );
  assert.equal(verifyRepository(root).state, 'stale');
  const change = join(box, 'changed'),
    generated = await complete(root, change, { update: true });
  assert.deepEqual(
    generated.requests.map((r) => r.source_path),
    ['auth', 'routes', '.'],
  );
  const update = await finalizeRepository(root, change);
  assert.deepEqual(update.regenerated, ['.', 'auth', 'routes']);
  assert.deepEqual(update.reused, ['unrelated']);
  assert.equal(verifyRepository(root).state, 'fresh');
  fs.renameSync(join(root, 'unrelated'), join(root, 'archive'));
  put(root, 'my-note.md', 'User content must remain.\n');
  const moved = join(box, 'moved');
  await complete(root, moved, { update: true });
  const afterMove = await finalizeRepository(root, moved);
  assert.equal(afterMove.changes.moves.length, 1);
  assert.equal(fs.existsSync(join(root, 'context/unrelated')), false);
  assert.equal(
    fs.readFileSync(join(root, 'my-note.md'), 'utf8'),
    'User content must remain.\n',
  );
  assert.equal(verifyRepository(root).state, 'fresh');
});
test('partial and inventory-only host builds preserve honest coverage without fabricated source bodies', async (t) => {
  const { root, session } = hostFixture(t, { unsupported: true });
  const { requests } = await complete(root, session);
  assert.ok(
    requests.every((r) =>
      r.input.sources.every((s) => !s.path.endsWith('.py')),
    ),
  );
  const built = await finalizeRepository(root, session);
  assert.equal(built.coverage, 'partial');
  assert.equal(verifyRepository(root).state, 'fresh');
  assert.match(
    fs.readFileSync(join(root, 'context/legacy/CONTEXT.md'), 'utf8'),
    /unsupported\\_language/,
  );
});
test('empty host scope needs no draft and completed sessions resume idempotently', async (t) => {
  const { root, session } = hostFixture(t, { empty: true });
  assert.equal((await prepareRepository(root, session)).status, 'ready');
  await finalizeRepository(root, session);
  const before = snapshot(root);
  assert.equal((await prepareRepository(root, session)).status, 'published');
  assert.equal((await finalizeRepository(root, session)).changed, false);
  assert.deepEqual(snapshot(root), before);
  assert.equal(readRequest(session).status, 'published');
  assert.equal(readState(session).completed, true);
});

test('explicit migration from optional API context invalidates old provider cache without an API key', async (t) => {
  const { root, session } = hostFixture(t);
  put(
    root,
    'shcontext.config.json',
    JSON.stringify({
      version: 1,
      folderWordLimit: 501,
      provider: { id: 'openai', model: 'test-model' },
    }),
  );
  const { envelope } = await import('./helpers/host.mjs');
  await buildRepository(root, {
    provider: {
      identity: { id: 'openai', model: 'test-model' },
      generate: async (request) =>
        envelope({ input: JSON.parse(request.input) }).draft,
    },
  });
  assert.equal(verifyRepository(root).state, 'fresh');
  put(
    root,
    'shcontext.config.json',
    JSON.stringify({
      version: 1,
      folderWordLimit: 501,
      provider: { id: 'host', model: 'claude-code-session' },
    }),
  );
  const ready = await complete(root, session, { update: true });
  assert.equal(ready.requests.length, 4);
  const result = await finalizeRepository(root, session);
  assert.deepEqual(result.reused, []);
  assert.equal(result.regenerated.length, 4);
  const manifest = JSON.parse(
    fs.readFileSync(join(root, 'context/.shcontext/manifest.json')),
  );
  assert.equal(manifest.generation.provider.id, 'host');
  assert.equal(manifest.selection.configuration.folderWordLimit, 501);
  assert.equal(verifyRepository(root).state, 'fresh');
});
