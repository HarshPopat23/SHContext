import assert from 'node:assert/strict';
import test from 'node:test';
import { symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeRepository } from '../dist/core/analyze-repository.js';
import { scanRepository, ScanError } from '../dist/scanner/index.js';
import {
  RepositoryAnalysisSchema,
  validateContract,
} from '../dist/core/contracts/index.js';
import { temporary, put, snapshot } from './helpers/extraction.mjs';

test('integration produces a deterministic validated report without source mutation', (t) => {
  const root = temporary(t, true),
    before = snapshot(root),
    report = analyzeRepository(root);
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(report, analyzeRepository(root));
  assert.ok(RepositoryAnalysisSchema.safeParse(report).success);
  assert.ok(validateContract('repositoryAnalysis', report).success);
  assert.equal(
    report.edges.length,
    report.analyses.reduce((n, a) => n + a.references.length, 0),
  );
});
test('changed source snapshots are rejected instead of analyzing stale inputs', (t) => {
  const root = temporary(t);
  put(root, 'file.ts', 'export const before=1;');
  const before = scanRepository(root);
  put(root, 'file.ts', 'export const after=2;');
  assert.throws(
    () =>
      analyzeRepository(root, { expectedInputId: before.inventory.input_id }),
    (e) => e instanceof ScanError && e.code === 'source_changed',
  );
  assert.equal(analyzeRepository(root).analyses[0].symbols[0].name, 'after');
});
test('boundary files are never read as source or promoted to dependency targets', (t) => {
  const root = temporary(t);
  put(
    root,
    'main.ts',
    "import './secret.ts'; import './link.ts'; import './binary.ts';",
  );
  put(root, 'secret.ts', 'export const token="AKIA' + 'Z'.repeat(16) + '";');
  put(root, 'binary.ts', Buffer.from([0, 1]));
  const outside = temporary(t);
  put(outside, 'outside.ts', 'throw new Error("never run")');
  try {
    symlinkSync(join(outside, 'outside.ts'), join(root, 'link.ts'), 'file');
  } catch (e) {
    if (process.platform === 'win32' && e.code === 'EPERM') {
      t.skip('Host does not permit file symlinks');
      return;
    }
    throw e;
  }
  const report = analyzeRepository(root);
  assert.deepEqual(
    report.analyses.map((a) => a.path),
    ['main.ts'],
  );
  assert.ok(
    report.edges.every((e) => e.to === null && e.reason === 'excluded_target'),
  );
  assert.ok(!JSON.stringify(report).includes('Z'.repeat(16)));
});
test('integration rejects fabricated coverage, targets, ranges and configuration evidence', (t) => {
  const original = analyzeRepository(temporary(t, true));
  for (const change of [
    (r) => r.analyses.pop(),
    (r) => r.edges.pop(),
    (r) => {
      const e = r.edges.find((e) => e.resolution === 'resolved');
      e.to = 'invented.ts';
    },
    (r) => {
      r.modules[0].sha256 = 'sha256:' + '0'.repeat(64);
    },
    (r) => {
      r.entry_points[0].evidence.sha256 = 'sha256:' + '0'.repeat(64);
    },
    (r) => {
      r.analyses.find((a) => a.references.length).references[0].end_byte =
        10000000;
    },
  ]) {
    const report = structuredClone(original);
    change(report);
    assert.equal(RepositoryAnalysisSchema.safeParse(report).success, false);
  }
});
test('integration accepts empty roots and empty text without guessing entry points', (t) => {
  const root = temporary(t);
  assert.deepEqual(analyzeRepository(root).analyses, []);
  put(root, 'empty.ts', '');
  put(root, 'src/index.ts', 'export {}');
  const report = analyzeRepository(root);
  assert.equal(
    report.analyses.find((a) => a.path === 'empty.ts').line_count,
    0,
  );
  assert.deepEqual(report.entry_points, []);
});
test('integration dependency evidence identifies the exact bytes containing each original import', (t) => {
  const root = temporary(t, true),
    report = analyzeRepository(root);
  for (const edge of report.edges) {
    const source = readFileSync(join(root, edge.from));
    const text = source
      .subarray(edge.reference.start_byte, edge.reference.end_byte)
      .toString();
    assert.match(text, /import|export|require/);
    if (edge.reference.specifier)
      assert.ok(text.includes(edge.reference.specifier));
  }
});

test('integration contract rejects unknown versions/fields and round-trips decoded object ordering', (t) => {
  const report = analyzeRepository(temporary(t, true));
  assert.equal(
    RepositoryAnalysisSchema.safeParse({ ...report, schema_version: 2 })
      .success,
    false,
  );
  assert.equal(
    RepositoryAnalysisSchema.safeParse({ ...report, unexpected: true }).success,
    false,
  );
  const decoded = JSON.parse(JSON.stringify(report));
  for (const edge of decoded.edges)
    edge.reference = Object.fromEntries(
      Object.entries(edge.reference).reverse(),
    );
  assert.ok(RepositoryAnalysisSchema.safeParse(decoded).success);
});

test('integration never executes source, package scripts or a configured provider', (t) => {
  const root = temporary(t);
  put(
    root,
    'shcontext.config.json',
    '{"version":1,"provider":{"id":"never-contact","model":"never-load"}}',
  );
  put(
    root,
    'danger.cjs',
    `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'executed.txt'))}, 'bad'); throw new Error('source executed');`,
  );
  put(
    root,
    'package.json',
    JSON.stringify({ scripts: { preinstall: 'this must not run' } }),
  );
  const before = snapshot(root),
    report = analyzeRepository(root);
  assert.deepEqual(snapshot(root), before);
  assert.equal(report.edges[0].reason, 'external_builtin');
  assert.ok(!JSON.stringify(report).includes('this must not run'));
});
