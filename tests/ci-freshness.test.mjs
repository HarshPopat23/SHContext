import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkFreshness,
  freshnessExit,
  summaryFor,
} from '../scripts/ci-freshness.mjs';
import { buildRepository } from '../dist/index.js';
import {
  fixture,
  fakeProvider,
  put,
  snapshot,
} from './helpers/verification.mjs';

test('CI policy distinguishes complete, partial and non-fresh snapshots', () => {
  assert.equal(freshnessExit({ state: 'fresh', coverage: 'complete' }), 0);
  assert.equal(freshnessExit({ state: 'fresh', coverage: 'partial' }), 2);
  assert.equal(freshnessExit({ state: 'fresh', coverage: 'partial' }, true), 0);
  for (const state of ['stale', 'unknown', 'invalid'])
    assert.equal(freshnessExit({ state, coverage: 'complete' }, true), 1);
});
test('freshness integration reports problems and leaves inspected source/context unchanged', async (t) => {
  const root = fixture(t, { sources: false });
  put(root, 'src/file.ts', 'export const answer=42;\n');
  await buildRepository(root, { provider: fakeProvider() });
  const box = fs.mkdtempSync(join(tmpdir(), 'shcontext CI report '));
  t.after(() => fs.rmSync(box, { recursive: true, force: true }));
  const options = {
    reportPath: join(box, 'report.json'),
    summaryPath: join(box, 'summary.md'),
  };
  let before = snapshot(root);
  assert.equal(checkFreshness(root, options).exitCode, 0);
  assert.deepEqual(snapshot(root), before);
  assert.match(fs.readFileSync(options.summaryPath, 'utf8'), /fresh/);
  assert.throws(() =>
    checkFreshness(root, { reportPath: join(box, 'missing/report.json') }),
  );
  assert.deepEqual(snapshot(root), before);
  put(root, 'src/file.ts', 'export const answer=43;\n');
  before = snapshot(root);
  assert.equal(checkFreshness(root, options).result.state, 'stale');
  assert.deepEqual(snapshot(root), before);
  fs.rmSync(join(root, 'context/CONTEXT.md'));
  before = snapshot(root);
  assert.equal(checkFreshness(root, options).result.state, 'invalid');
  assert.deepEqual(snapshot(root), before);
});
test('partial coverage requires an explicit organization policy and summary paths cannot inject Markdown', async (t) => {
  const root = fixture(t, { sources: false, partial: true });
  await buildRepository(root, { provider: fakeProvider() });
  assert.equal(checkFreshness(root).exitCode, 2);
  assert.equal(checkFreshness(root, { allowPartial: true }).exitCode, 0);
  const text = summaryFor({
    state: 'fresh',
    coverage: 'complete',
    findings: [
      { code: 'source_changed', path: '```\n<img src=x>\n::error::bad' },
    ],
  });
  assert.ok(
    !text.includes('<img') &&
      !text.includes('```') &&
      !text.includes('::error::'),
  );
});
