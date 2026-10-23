import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  updateRepository,
  verifyRepository,
  buildRepository,
} from '../dist/index.js';
import { olderComponent } from '../tests/helpers/update.mjs';
import {
  readJSON,
  configure,
  put,
  evaluate,
  providerFor,
  reviewClaims,
  flatSummarize,
  accounting,
  budget,
  parseOptions,
  emitReport,
} from './evaluate.mjs';

const options = parseOptions(process.argv.slice(2));
const root = fs.mkdtempSync(join(tmpdir(), 'shcontext quality '));
try {
  const dataset = readJSON(
    new URL('./datasets/controlled.json', import.meta.url),
  );
  for (const [path, text] of Object.entries(dataset.files))
    put(root, path, text);
  configure(root);
  const evaluation = await evaluate(root, dataset, options);
  const updates = [];
  const scenarios = [
    { name: 'unchanged', apply() {}, expected: [] },
    {
      name: 'isolated-edit',
      apply() {
        put(root, 'unrelated/info.ts', 'export const info = 2;\n');
      },
      expected: ['.', 'unrelated'],
    },
    {
      name: 'addition',
      apply() {
        put(root, 'extra/new.ts', 'export const added=1;\n');
      },
      expected: ['.', 'extra'],
    },
    {
      name: 'move',
      apply() {
        fs.mkdirSync(join(root, 'archive'));
        fs.renameSync(
          join(root, 'unrelated/info.ts'),
          join(root, 'archive/info.ts'),
        );
        fs.rmdirSync(join(root, 'unrelated'));
      },
      expected: ['.', 'archive'],
    },
    {
      name: 'deletion',
      apply() {
        fs.rmSync(join(root, 'extra'), { recursive: true });
      },
      expected: ['.'],
    },
    {
      name: 'dependency-evidence-edit',
      apply() {
        fs.appendFileSync(
          join(root, 'src/auth/session.ts'),
          '// A reviewed source identity change.\n',
        );
      },
      expected: ['.', 'src', 'src/auth', 'src/routes'],
    },
    {
      name: 'configuration-invalidation',
      apply() {
        const config = readJSON(join(root, 'shcontext.config.json'));
        config.folderWordLimit = 501;
        put(root, 'shcontext.config.json', JSON.stringify(config));
      },
      expected: null,
    },
    {
      name: 'generator-invalidation',
      apply() {
        olderComponent(root, 'generator');
      },
      expected: null,
    },
  ];
  for (const scenario of scenarios) {
    const before = readJSON(join(root, 'context/.shcontext/cache.json'));
    scenario.apply();
    const p = providerFor(dataset),
      start = performance.now();
    const result = await updateRepository(root, {
      provider: p,
      execution: { budget },
    });
    const metrics = accounting(p, result.execution, performance.now() - start);
    const expected =
      scenario.expected ??
      result.bundle.folders.map((x) => x.source_path).sort();
    assert.deepEqual(result.regenerated, expected, scenario.name);
    assert.equal(verifyRepository(root).state, 'fresh', scenario.name);
    for (const reused of result.reused) {
      const old = before.folders.find(
        (x) => x.summary.source_path === reused,
      ).summary;
      const now = result.bundle.folders.find((x) => x.source_path === reused);
      const prose = (folder) => ({
        purpose: folder.purpose.map(({ evidence_ids, ...claim }) => claim),
        files: folder.files.map((file) => ({
          path: file.path,
          claims: file.claims.map(({ evidence_ids, ...claim }) => claim),
        })),
      });
      assert.deepEqual(prose(now), prose(old));
    }
    if (scenario.name === 'unchanged') {
      assert.equal(result.model_calls, 0);
      assert.equal(result.changed, false);
    }
    if (scenario.name === 'move') {
      assert.equal(fs.existsSync(join(root, 'context/unrelated')), false);
      assert.equal(result.changes.moves.length, 1);
    }
    if (scenario.name === 'deletion')
      assert.equal(fs.existsSync(join(root, 'context/extra')), false);
    const flat = await flatSummarize(root, dataset);
    updates.push({
      name: scenario.name,
      expected_regenerated: expected,
      regenerated: result.regenerated,
      reused: result.reused,
      changes: result.changes,
      correct: true,
      metrics,
      flat_regeneration: flat.metrics,
    });
  }
  // Restore original source/control identity before applying a semantically false, well-cited control.
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root);
  for (const [path, text] of Object.entries(dataset.files))
    put(root, path, text);
  configure(root);
  const negative = await buildRepository(root, {
    provider: providerFor(dataset, { negative: true }),
  });
  const negativeClaims = reviewClaims(negative.bundle, dataset);
  assert.equal(verifyRepository(root).state, 'fresh');
  assert.equal(negativeClaims.unsupported, 1);
  assert.throws(() => assert.equal(negativeClaims.unsupported, 0));
  const report = {
    schema_version: 1,
    mode: 'controlled scripted provider; no live model evaluation',
    node: process.version,
    platform: process.platform,
    evaluation,
    updates,
    negative_control: {
      mechanical_freshness: 'fresh',
      claims: negativeClaims,
      expected_rejection: true,
    },
    live_measurement: {
      status: 'blocked',
      reason:
        'Requires an authorized OpenAI key, available model and independent source review; controlled reservations are not actual model tokens or invoices.',
    },
  };
  await emitReport(report, options, 'QUALITY BENCHMARK PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
