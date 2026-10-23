import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRepository, verifyRepository } from '../dist/index.js';
import {
  readJSON,
  configure,
  put,
  bindFacts,
  providerFor,
  reviewClaims,
  scoreRetrieval,
  evaluate,
  relationshipLabels,
} from '../benchmarks/evaluate.mjs';

test('retrieval measures source hits, precision, recall and abstention without declaring missing answers correct', () => {
  assert.deepEqual(scoreRetrieval(['a', 'a', 'b'], ['a', 'c']), {
    hits: 1,
    expected: 2,
    returned: 2,
    recall: 0.5,
    precision: 0.5,
    exact_set: false,
    all_expected: false,
    correct_abstention: null,
  });
  assert.equal(scoreRetrieval([], ['a']).all_expected, false);
  assert.equal(scoreRetrieval(['a'], []).correct_abstention, false);
  assert.equal(scoreRetrieval([], []).correct_abstention, true);
  const unresolved = {
    from: 'a.ts',
    to: null,
    reference: { specifier: 'missing' },
    resolution: 'unresolved',
  };
  assert.equal(
    relationshipLabels(
      [unresolved],
      [
        {
          from: 'a.ts',
          to: null,
          specifier: 'missing',
          resolution: 'unresolved',
        },
      ],
    ),
    true,
  );
  assert.equal(
    relationshipLabels(
      [{ ...unresolved, to: 'invented.ts', resolution: 'resolved' }],
      [
        {
          from: 'a.ts',
          to: null,
          specifier: 'missing',
          resolution: 'unresolved',
        },
      ],
    ),
    false,
  );
});
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'shcontext evaluation controls '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataset = readJSON(
    new URL('../benchmarks/datasets/controlled.json', import.meta.url),
  );
  for (const [path, text] of Object.entries(dataset.files))
    put(root, path, text);
  configure(root);
  bindFacts(root, dataset);
  return { root, dataset };
}
test('source-reviewed labels bind to current source hashes and ranges; unknown prose is not certified', async (t) => {
  const { root, dataset } = fixture(t);
  const built = await buildRepository(root, { provider: providerFor(dataset) });
  const result = reviewClaims(built.bundle, dataset);
  assert.equal(result.supported, 5);
  assert.equal(result.unsupported, 0);
  assert.equal(
    built.bundle.folders.find((f) => f.source_path === 'legacy').files[0].claims
      .length,
    0,
  );
  const changed = structuredClone(built.bundle);
  changed.folders.find(
    (f) => f.source_path === 'src/auth',
  ).files[0].claims[0].text = 'Unreviewed new behavioral assertion.';
  const unknown = reviewClaims(changed, dataset);
  assert.equal(unknown.supported, 4);
  assert.equal(unknown.unreviewed, 1);
  put(root, 'src/auth/session.ts', 'export const different=1;\n');
  assert.throws(() => bindFacts(root, dataset), /Ground truth drift/);
});
test('well-cited unsupported prose can be mechanically fresh while the reviewed negative control rejects it', async (t) => {
  const { root, dataset } = fixture(t);
  const built = await buildRepository(root, {
    provider: providerFor(dataset, { negative: true }),
  });
  assert.equal(verifyRepository(root).state, 'fresh');
  const result = reviewClaims(built.bundle, dataset);
  assert.equal(result.unsupported, 1);
  assert.throws(() => assert.equal(result.unsupported, 0));
});
test('fixture evaluation actually retrieves expected implementations and compares both declared baselines', async (t) => {
  const { root, dataset } = fixture(t);
  const result = await evaluate(root, dataset, { check: true });
  assert.equal(result.questions.length, 5);
  assert.ok(result.questions.every((x) => x.shcontext.score.all_expected));
  assert.ok(result.questions.some((x) => x.cross_folder));
  assert.equal(result.generation.actual_model_tokens, null);
  assert.equal(result.generation.actual_provider_cost_usd, 0);
  assert.ok(result.generation.reserved_input_tokens > 0);
  assert.ok(result.flat_generation.requests > 0);
  assert.ok(
    result.questions.every(
      (x) => x.literal_exploration.score && x.flat_folder.score,
    ),
  );
});
