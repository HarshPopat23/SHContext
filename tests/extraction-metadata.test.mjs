import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRepository } from '../dist/core/analyze-repository.js';
import { temporary, put } from './helpers/extraction.mjs';

test('entry points preserve package selectors, conditional declarations, missing files and patterns', (t) => {
  const report = analyzeRepository(temporary(t, true));
  assert.deepEqual(
    report.entry_points.map((e) => [e.kind, e.selector, e.to, e.reason]),
    [
      ['main', '/main', 'src/index.ts', null],
      ['types', '/types', 'src/types.ts', null],
      ['bin', '/bin/fixture', 'src/cli.ts', null],
      ['exports', '/exports/./import', 'src/index.ts', null],
      ['exports', '/exports/./require', 'src/common.cjs', null],
      ['exports', '/exports/.~1*', null, 'pattern'],
      ['exports', '/exports/.~1missing', null, 'missing_target'],
    ],
  );
  assert.ok(
    report.entry_points.every((e) => e.evidence.basis === 'configuration'),
  );
});
test('configuration facts record script names without command execution or command values', (t) => {
  const report = analyzeRepository(temporary(t, true));
  const pkg = report.configuration.find((c) => c.path === 'package.json');
  assert.ok(
    pkg.facts.some((f) => f.kind === 'script-name' && f.value === 'start'),
  );
  assert.ok(
    pkg.facts.some(
      (f) => f.kind === 'dependency-name' && f.value === 'example-package',
    ),
  );
  assert.ok(
    !JSON.stringify(report).includes('this command must never execute'),
  );
  const ts = report.configuration.find((c) => c.path === 'tsconfig.json');
  assert.ok(
    ts.facts.some(
      (f) =>
        f.kind === 'path-alias' &&
        f.pointer === '/compilerOptions/paths/@app~1*',
    ),
  );
  assert.ok(
    ts.facts.some((f) => f.kind === 'compiler-option' && f.value === true),
  );
});
test('fallback labels unsupported languages and parser failures without invented symbols or relationships', (t) => {
  const root = temporary(t, true);
  put(root, 'broken.ts', 'export const broken: = ;');
  put(root, 'README.md', '# Features');
  const report = analyzeRepository(root);
  const python = report.analyses.find((a) => a.path.endsWith('.py'));
  assert.equal(python.mode, 'inventory-only');
  assert.equal(python.language, 'python');
  assert.deepEqual(python.symbols, []);
  assert.deepEqual(python.references, []);
  assert.match(python.diagnostics[0].message, /fallback/);
  const broken = report.analyses.find((a) => a.path === 'broken.ts');
  assert.equal(broken.disposition, 'parse-error');
  assert.deepEqual(broken.symbols, []);
  assert.ok(!report.modules.some((m) => m.path === 'broken.ts'));
  assert.equal(report.inventory.coverage, 'partial');
});
test('malformed and duplicated configuration never yields trusted facts or entry points', (t) => {
  for (const text of [
    '{"main":"./yes.ts","main":"./other.ts"}',
    '{"main":',
    '{/*comment*/"main":"./yes.ts"}',
  ]) {
    const root = temporary(t);
    put(root, 'package.json', text);
    put(root, 'yes.ts', 'export {}');
    const report = analyzeRepository(root);
    assert.deepEqual(report.entry_points, []);
    assert.deepEqual(report.configuration[0].facts, []);
    assert.equal(
      report.configuration[0].diagnostics[0].code,
      'configuration_uncertain',
    );
  }
});
test('entry points use exact package-relative files and do not execute or resolve external targets', (t) => {
  const root = temporary(t);
  put(
    root,
    'package.json',
    JSON.stringify({
      main: './source',
      module: '../outside.ts',
      types: './dist/types.d.ts',
      bin: './tool.ts',
      exports: { import: 'https://example.com/x.js' },
    }),
  );
  put(root, 'source.ts', 'export {}');
  put(root, 'tool.ts', 'export {}');
  put(root, 'dist/types.d.ts', 'export {}');
  const report = analyzeRepository(root);
  assert.deepEqual(
    report.entry_points.map((e) => e.reason),
    [
      'missing_target',
      'outside_root',
      'excluded_target',
      null,
      'unsupported_resolution',
    ],
  );
});
test('configuration source ranges preserve a BOM and nested package roots', (t) => {
  const root = temporary(t);
  put(root, 'packages/a/package.json', '\ufeff{\r\n"main":"./index.ts"\r\n}');
  put(root, 'packages/a/index.ts', 'export {}');
  const entry = analyzeRepository(root).entry_points[0];
  assert.equal(entry.to, 'packages/a/index.ts');
  assert.equal(entry.evidence.start_line, 2);
});

test('configuration does not invent entry declarations from malformed main/module value shapes', (t) => {
  const root = temporary(t);
  put(
    root,
    'package.json',
    '{"main":{"fake":"./source.ts"},"module":["./source.ts"]}',
  );
  put(root, 'source.ts', 'export {}');
  const report = analyzeRepository(root);
  assert.deepEqual(report.entry_points, []);
  assert.equal(report.configuration[0].diagnostics.length, 2);
});
