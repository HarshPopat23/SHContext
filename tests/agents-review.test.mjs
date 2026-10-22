import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildRepository,
  updateRepository,
  verifyRepository,
  AGENT_ROLES,
  ReviewError,
} from '../dist/index.js';
import { fixture, provider, put } from './helpers/agents.mjs';
import { snapshot } from './helpers/verification.mjs';

test('four executable roles run sequentially by default with bounded source evidence', async (t) => {
  const root = fixture(t),
    p = provider({ latency: 5 });
  const result = await buildRepository(root, { provider: p });
  assert.equal(p.peak, 1);
  const roles = new Set(result.execution.tasks.map((task) => task.role));
  assert.deepEqual([...roles].sort(), Object.keys(AGENT_ROLES).sort());
  assert.ok(
    p.calls
      .filter((call) => call.input.source_path !== '.')
      .every((call) => call.request.role === 'Folder Analyst'),
  );
  assert.equal(
    p.calls.find((call) => call.input.source_path === '.').request.role,
    'Architecture Analyst',
  );
  assert.ok(
    result.execution.reviews.every(
      (review) =>
        review.mode === 'mechanical' && review.status === 'not-reviewed',
    ),
  );
  assert.equal(p.reviews.length, 0);
  assert.equal(verifyRepository(root).state, 'fresh');
});
test('explicit model review receives every narrative claim and its actual cited source', async (t) => {
  const root = fixture(t),
    p = provider();
  const result = await buildRepository(root, { provider: p, review: true });
  assert.equal(p.reviews.length, result.bundle.folders.length);
  for (const { input, request } of p.reviews) {
    assert.equal(request.role, 'Verifier');
    assert.ok(input.claims.length);
    for (const claim of input.claims)
      for (const id of claim.evidence_ids) {
        const source = input.evidence.find((item) => item.id === id);
        assert.ok(source?.content.length);
        assert.ok(
          source.path === 'shcontext.config.json' ||
            source.content.includes('return value.trim()'),
        );
      }
  }
  assert.ok(
    result.execution.reviews.every(
      (review) => review.status === 'no-issues-found',
    ),
  );
  assert.equal(result.execution.requests, p.calls.length + p.reviews.length);
  assert.equal(verifyRepository(root).state, 'fresh');
});
test('Verifier flags a controlled contradictory explanation and preserves the prior tree', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: provider() });
  const before = snapshot(join(root, 'context'));
  const p = provider({
    transform: (draft) => {
      draft.purpose[0].text = 'Launches spacecraft.';
      return draft;
    },
  });
  await assert.rejects(
    buildRepository(root, { provider: p, review: true }),
    (error) => {
      assert.ok(error instanceof ReviewError);
      assert.equal(error.code, 'review_concerns');
      assert.ok(
        error.reviews.some((review) =>
          review.findings.some((finding) => finding.verdict === 'contradicted'),
        ),
      );
      return true;
    },
  );
  assert.deepEqual(snapshot(join(root, 'context')), before);
});
for (const mode of [
  'missing',
  'duplicate',
  'invented-claim',
  'invented-evidence',
  'unsafe-explanation',
  'insufficient',
])
  test(`Verifier rejects ${mode} review instead of certifying it`, async (t) => {
    const root = fixture(t),
      p = provider({
        reviewTransform: (draft) => {
          if (mode === 'missing') draft.reviews.pop();
          if (mode === 'duplicate') draft.reviews.push(draft.reviews[0]);
          if (mode === 'invented-claim') draft.reviews[0].claim_id = 'C9999';
          if (mode === 'invented-evidence')
            draft.reviews[0].evidence_ids = ['E99999'];
          if (mode === 'unsafe-explanation')
            draft.reviews[0].explanation = '\x1b[31munsafe';
          if (mode === 'insufficient')
            draft.reviews[0].verdict = 'insufficient';
          return draft;
        },
      });
    await assert.rejects(
      buildRepository(root, { provider: p, review: true }),
      (error) =>
        error.code ===
        (mode === 'insufficient' ? 'review_concerns' : 'invalid_review'),
    );
    assert.equal(verifyRepository(root).state, 'invalid');
  });
test('model review is fallible: a controlled always-support response is not mechanical proof', async (t) => {
  const root = fixture(t),
    p = provider({
      transform: (draft) => {
        draft.purpose[0].text = 'Launches spacecraft.';
        return draft;
      },
      reviewTransform: (draft) => {
        for (const item of draft.reviews) item.verdict = 'supported';
        return draft;
      },
    });
  const result = await buildRepository(root, { provider: p, review: true });
  assert.equal(verifyRepository(root).state, 'fresh');
  assert.ok(
    result.execution.reviews.every(
      (review) => review.status === 'no-issues-found',
    ),
  );
  assert.match(result.bundle.folders[0].purpose[0].text, /spacecraft/);
});
test('default unchanged update remains zero-call, while explicit review checks reused summaries', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: provider() });
  const p = provider(),
    noop = await updateRepository(root, { provider: p });
  assert.equal(noop.model_calls, 0);
  assert.equal(p.calls.length + p.reviews.length, 0);
  const before = snapshot(join(root, 'context'));
  const reviewed = await updateRepository(root, {
    provider: p,
    review: true,
    execution: { workers: 3 },
  });
  assert.equal(reviewed.changed, false);
  assert.equal(p.calls.length, 0);
  assert.equal(p.reviews.length, reviewed.bundle.folders.length);
  assert.deepEqual(snapshot(join(root, 'context')), before);
});
test('source edits during model review are caught before publication', async (t) => {
  const root = fixture(t);
  await buildRepository(root, { provider: provider() });
  const before = snapshot(join(root, 'context'));
  const p = provider({
    reviewTransform: (draft) => {
      put(root, 'feature-0/index.ts', 'export const changed=2;');
      return draft;
    },
  });
  await assert.rejects(
    buildRepository(root, { provider: p, review: true }),
    (error) => error.code === 'source_changed',
  );
  assert.deepEqual(snapshot(join(root, 'context')), before);
});

test('model-authored limitations are reviewed rather than serving as a hiding place for behavioral claims', async (t) => {
  const root = fixture(t),
    p = provider({
      transform: (draft) => {
        draft.uncertainty = ['Launches spacecraft.'];
        return draft;
      },
    });
  await assert.rejects(
    buildRepository(root, { provider: p, review: true }),
    (error) => error.code === 'review_concerns',
  );
  assert.ok(
    p.reviews.some((call) =>
      call.input.claims.some((claim) => claim.text === 'Launches spacecraft.'),
    ),
  );
});
