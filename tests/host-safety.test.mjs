import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import {
  prepareRepository,
  submitRepository,
  finalizeRepository,
  readHostSubmission,
  verifyRepository,
} from '../dist/index.js';
import {
  hostFixture,
  complete,
  readRequest,
  readState,
  envelope,
  snapshot,
  put,
} from './helpers/host.mjs';

for (const [name, mutate] of [
  [
    'unknown citation',
    (d) => {
      d.purpose[0].evidence_ids = ['E999'];
    },
  ],
  [
    'missing file coverage',
    (d) => {
      d.files = [];
    },
  ],
  [
    'invented file',
    (d) => {
      d.files[0].path = '../escape.ts';
    },
  ],
  [
    'missing inference rationale',
    (d) => {
      d.purpose[0].rationale = null;
    },
  ],
  [
    'malformed fields',
    (d) => {
      d.unrecognized = true;
    },
  ],
  [
    'unsupported executed-test assertion field',
    (d) => {
      d.tests = [
        {
          path: 'auth/session.ts',
          text: 'Tests ran',
          evidence_ids: ['E1'],
          execution: 'passed',
        },
      ];
    },
  ],
])
  test(`invalid host draft rejects ${name} without changing session/source/output`, async (t) => {
    const { root, session } = hostFixture(t);
    await prepareRepository(root, session);
    const response = envelope(readRequest(session));
    mutate(response.draft);
    const before = snapshot(root),
      sessionBefore = snapshot(session);
    await assert.rejects(
      submitRepository(root, session, response),
      (e) => e.code === 'invalid_draft',
    );
    assert.deepEqual(snapshot(root), before);
    assert.deepEqual(snapshot(session), sessionBefore);
  });
test('wrong session/request, oversized and duplicate-key envelopes cannot advance host state', async (t) => {
  const { root, session, box } = hostFixture(t);
  await prepareRepository(root, session);
  const response = envelope(readRequest(session)),
    before = snapshot(session);
  for (const invalid of [
    { ...response, session_id: '11111111-1111-4111-8111-111111111111' },
    { ...response, request_id: 'sha256:' + '0'.repeat(64) },
    { ...response, draft: { text: 'a'.repeat(65536) } },
  ])
    await assert.rejects(submitRepository(root, session, invalid));
  const path = join(box, 'duplicate.json');
  fs.writeFileSync(
    path,
    '{"session_id":"a","session_id":"b","request_id":"x","draft":{}}',
  );
  assert.throws(() => readHostSubmission(path));
  assert.deepEqual(snapshot(session), before);
  await assert.rejects(
    finalizeRepository(root, session),
    (e) => e.code === 'host_incomplete',
  );
  assert.equal(fs.existsSync(join(root, 'context')), false);
});
for (const [name, change] of [
  [
    'source edit',
    (root) => fs.appendFileSync(join(root, 'auth/session.ts'), '// changed\n'),
  ],
  ['addition', (root) => put(root, 'extra/new.ts', 'export const x=1;\n')],
  ['deletion', (root) => fs.rmSync(join(root, 'auth/session.ts'))],
  [
    'move',
    (root) =>
      fs.renameSync(join(root, 'auth/session.ts'), join(root, 'auth/moved.ts')),
  ],
  [
    'configuration',
    (root) => {
      const p = join(root, 'shcontext.config.json'),
        c = JSON.parse(fs.readFileSync(p));
      c.folderWordLimit = 501;
      fs.writeFileSync(p, JSON.stringify(c));
    },
  ],
])
  test(`host finalization rejects ${name} after preparation and retains old context`, async (t) => {
    const { root, session, box } = hostFixture(t);
    await complete(root, session);
    await finalizeRepository(root, session);
    const next = join(box, 'rebuild');
    await complete(root, next);
    const before = snapshot(join(root, 'context'));
    change(root);
    await assert.rejects(
      finalizeRepository(root, next),
      (e) => e.code === 'host_snapshot_changed',
    );
    assert.deepEqual(snapshot(join(root, 'context')), before);
  });
test('component identity drift and edited persisted drafts are revalidated, never trusted as approved state', async (t) => {
  const { root, session } = hostFixture(t);
  await complete(root, session);
  const state = readState(session),
    path = join(session, 'session.json');
  fs.writeFileSync(
    path,
    JSON.stringify({ ...state, generation_id: 'sha256:' + '0'.repeat(64) }),
  );
  await assert.rejects(
    finalizeRepository(root, session),
    (e) => e.code === 'host_snapshot_changed',
  );
  state.answers[0].draft.purpose[0].evidence_ids = ['E999'];
  fs.writeFileSync(path, JSON.stringify(state));
  await assert.rejects(
    finalizeRepository(root, session),
    (e) => e.code === 'invalid_draft',
  );
  assert.equal(fs.existsSync(join(root, 'context')), false);
});
test('output edits or another valid publication invalidate the prepared baseline', async (t) => {
  const { root, session, box } = hostFixture(t);
  await complete(root, session);
  await finalizeRepository(root, session);
  const next = join(box, 'rebuild');
  await complete(root, next);
  fs.appendFileSync(join(root, 'context/CONTEXT.md'), 'user edit\n');
  const before = snapshot(join(root, 'context'));
  await assert.rejects(finalizeRepository(root, next));
  assert.deepEqual(snapshot(join(root, 'context')), before);
});
test('session boundaries reject selected-root paths, wrong roots, unknown files and concurrent writers', async (t) => {
  const { root, session, box } = hostFixture(t);
  await assert.rejects(
    prepareRepository(root, join(root, 'session')),
    (e) => e.code === 'host_session_path',
  );
  assert.equal(fs.existsSync(join(root, 'session')), false);
  const settled = await Promise.allSettled([
    prepareRepository(root, session),
    prepareRepository(root, session),
  ]);
  assert.equal(settled.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(
    settled.find((x) => x.status === 'rejected').reason.code,
    'host_session_locked',
  );
  const other = join(box, 'other');
  fs.mkdirSync(other);
  await assert.rejects(
    prepareRepository(other, session),
    (e) => e.code === 'host_session_invalid',
  );
  put(session, 'unknown-note', 'keep');
  const before = snapshot(session);
  await assert.rejects(
    prepareRepository(root, session),
    (e) => e.code === 'host_session_invalid',
  );
  assert.deepEqual(snapshot(session), before);
});
test('linked session directories, files and linked ancestors into source are rejected', async (t) => {
  const { root, session, box } = hostFixture(t);
  await prepareRepository(root, session);
  const linked = join(box, 'linked');
  try {
    fs.symlinkSync(root, linked, 'junction');
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) {
      t.skip('Host cannot create links');
      return;
    }
    throw e;
  }
  await assert.rejects(
    prepareRepository(root, join(linked, 'session')),
    (e) => e.code === 'host_session_path',
  );
  const statePath = join(session, 'session.json'),
    outside = join(box, 'state-copy.json');
  fs.renameSync(statePath, outside);
  fs.symlinkSync(outside, statePath, 'file');
  const original = fs.readFileSync(outside);
  await assert.rejects(prepareRepository(root, session));
  assert.deepEqual(fs.readFileSync(outside), original);
});
test('request evidence bound rejects oversized folders without truncation or publication', async (t) => {
  const { root, session } = hostFixture(t);
  put(
    root,
    'auth/large.ts',
    '// ' + 'a'.repeat(530000) + '\nexport const x=1;\n',
  );
  await assert.rejects(prepareRepository(root, session), (e) =>
    ['host_size_limit', 'agent_budget'].includes(e.code),
  );
  assert.equal(fs.existsSync(join(root, 'context')), false);
  assert.equal(fs.existsSync(join(session, 'session.json')), false);
});
test('interruption after publication but before completion recording resumes without rewriting output', async (t) => {
  const { root, session } = hostFixture(t);
  await complete(root, session);
  await finalizeRepository(root, session);
  const state = readState(session);
  state.completed = false;
  fs.writeFileSync(join(session, 'session.json'), JSON.stringify(state));
  const before = snapshot(join(root, 'context'));
  const result = await finalizeRepository(root, session);
  assert.equal(result.recovered, true);
  assert.equal(result.changed, false);
  assert.deepEqual(snapshot(join(root, 'context')), before);
  assert.equal(verifyRepository(root).state, 'fresh');
});
test('source mutation at staged publication fails final comparison and preserves previous output', async (t) => {
  const { root, session, box } = hostFixture(t);
  await complete(root, session);
  await finalizeRepository(root, session);
  const next = join(box, 'rebuild');
  await complete(root, next);
  const before = snapshot(join(root, 'context')),
    original = fs.mkdirSync;
  const mock = t.mock.method(fs, 'mkdirSync', function (path, ...args) {
    const result = original.call(this, path, ...args);
    if (String(path).includes('stage-'))
      fs.appendFileSync(join(root, 'auth/session.ts'), '// source raced\n');
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  await assert.rejects(
    finalizeRepository(root, next),
    (e) => e.code === 'host_snapshot_changed',
  );
  assert.deepEqual(snapshot(join(root, 'context')), before);
});

test('independent host sessions cannot publish concurrently or overwrite a newer owned result', async (t) => {
  const { root, session, box } = hostFixture(t);
  const other = join(box, 'other-session');
  await complete(root, session);
  await complete(root, other);
  const settled = await Promise.allSettled([
    finalizeRepository(root, session),
    finalizeRepository(root, other),
  ]);
  assert.equal(settled.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(
    settled.find((x) => x.status === 'rejected').reason.code,
    'build_locked',
  );
  const before = snapshot(join(root, 'context'));
  const loser = settled[0].status === 'rejected' ? session : other;
  await assert.rejects(
    finalizeRepository(root, loser),
    (e) => e.code === 'host_output_changed',
  );
  assert.deepEqual(snapshot(join(root, 'context')), before);
  assert.equal(verifyRepository(root).state, 'fresh');
});
