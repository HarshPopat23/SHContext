import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRepository } from '../dist/core/analyze-repository.js';
import { extract, temporary, put } from './helpers/extraction.mjs';

test('dependencies match known literal imports including every unresolved fixture case', (t) => {
  const report = analyzeRepository(temporary(t, true));
  const edges = report.edges.filter((e) => e.from === 'src/index.ts');
  assert.deepEqual(
    edges.map((e) => [
      e.reference.kind,
      e.reference.specifier,
      e.resolution,
      e.to,
      e.reason,
    ]),
    [
      ['import', './greet.ts', 'resolved', 'src/greet.ts', null],
      ['import', './types', 'resolved', 'src/types.ts', null],
      ['import', 'node:fs', 'external', null, 'external_builtin'],
      ['import', 'example-package', 'external', null, 'external_package'],
      ['import', '@app/internal', 'unresolved', null, 'alias'],
      ['import', '#private', 'unresolved', null, 'alias'],
      ['import', './missing', 'unresolved', null, 'missing_target'],
      ['import', './ambiguous', 'unresolved', null, 'ambiguous'],
      ['import', './excluded', 'unresolved', null, 'excluded_target'],
      ['import', '../context/hidden.ts', 'unresolved', null, 'excluded_target'],
      ['import', '../../../outside', 'unresolved', null, 'outside_root'],
      ['re-export', './greet.ts', 'resolved', 'src/greet.ts', null],
      ['re-export', './types.ts', 'resolved', 'src/types.ts', null],
      ['require', './common.cjs', 'resolved', 'src/common.cjs', null],
      ['dynamic-import', './greet.ts', 'resolved', 'src/greet.ts', null],
      ['dynamic-import', null, 'unresolved', null, 'computed'],
      ['import', './types.ts', 'resolved', 'src/types.ts', null],
    ],
  );
});
test('resolution is unique across extensionless and index candidates, with no emitted-extension guessing', (t) => {
  const root = temporary(t);
  put(
    root,
    'main.ts',
    "import './one'; import './folder'; import './both'; import './emitted.js'; import './exact.js';",
  );
  put(root, 'one.ts', 'export {}');
  put(root, 'folder/index.ts', 'export {}');
  put(root, 'both.js', 'export {}');
  put(root, 'both/index.ts', 'export {}');
  put(root, 'emitted.ts', 'export {}');
  put(root, 'exact.js', 'export {}');
  put(root, 'exact.ts', 'export {}');
  assert.deepEqual(
    analyzeRepository(root).edges.map((e) => [e.to, e.reason]),
    [
      ['one.ts', null],
      ['folder/index.ts', null],
      [null, 'ambiguous'],
      [null, 'missing_target'],
      ['exact.js', null],
    ],
  );
});
test('references distinguish namespace/default/named/side-effect imports and type-only declarations', () => {
  const { module } = extract(
    "import main, {value as local, type Thing} from './api'; import * as all from './api'; import './setup'; import type DefaultType from './types';",
  );
  assert.deepEqual(
    module.imports.map((i) => [i.kind, i.imported, i.local, i.type_only]),
    [
      ['default', 'default', 'main', false],
      ['named', 'value', 'local', false],
      ['named', 'Thing', 'Thing', true],
      ['namespace', '*', 'all', false],
      ['side-effect', null, null, false],
      ['default', 'default', 'DefaultType', true],
    ],
  );
});
test('computed dynamic imports and require calls never become confirmed edges', (t) => {
  const root = temporary(t);
  put(
    root,
    'main.ts',
    "const first = require(variable); const second = import(`./${variable}`); import('');",
  );
  const edges = analyzeRepository(root).edges;
  assert.deepEqual(
    edges.map((e) => [e.reference.specifier, e.to, e.reason]),
    [
      [null, null, 'computed'],
      [null, null, 'computed'],
      ['', null, 'unsupported_resolution'],
    ],
  );
});
test('shadowed, hoisted, reassigned and dynamically scoped require calls are not confirmed dependencies', () => {
  for (const source of [
    "function call(require) { return require('./fake'); }",
    "require('./fake'); var require = custom;",
    "require = custom; require('./fake');",
    "with (scope) { require('./fake'); }",
  ]) {
    const result = extract(source, 'scope.cjs');
    assert.deepEqual(result.analysis.references, []);
    assert.ok(
      result.module.diagnostics.some((d) => d.code === 'uncertain_require'),
    );
  }
  const positive = extract("const real = require('./real');", 'scope.cjs');
  assert.equal(positive.analysis.references.length, 1);
  const shadowed = extract(
    'function f(module, exports) { module.exports = 1; exports.fake = 2; }',
    'scope.cjs',
  );
  assert.deepEqual(shadowed.module.exports, []);
});
test('resolution preserves unsupported protocols, query syntax and absolute/outside-root references', (t) => {
  const root = temporary(t);
  put(
    root,
    'main.ts',
    "import 'https://example.com/a.js'; import './file.ts?raw'; import '/outside/file.ts'; import 'C:\\\\outside\\\\file.ts'; import '.odd';",
  );
  put(root, 'file.ts', 'export {}');
  const edges = analyzeRepository(root).edges;
  assert.deepEqual(
    edges.map((e) => e.reason),
    [
      'unsupported_resolution',
      'unsupported_resolution',
      'outside_root',
      'outside_root',
      'unsupported_resolution',
    ],
  );
  assert.ok(edges.every((e) => e.to === null));
});
test('resolution does not follow pruned targets, and uncertainty prevents a unique-file claim', (t) => {
  const root = temporary(t);
  put(root, 'main.ts', "import './blocked/inside'; import './version';");
  put(root, '.shcontextignore', 'blocked/\nversion.ts');
  put(root, 'blocked/inside.ts', 'export {}');
  put(root, 'version.js', 'export {}');
  put(root, 'version.ts', 'export {}');
  assert.deepEqual(
    analyzeRepository(root).edges.map((e) => [e.to, e.reason]),
    [
      [null, 'excluded_target'],
      [null, 'excluded_target'],
    ],
  );
});
test('alias resolution respects configured path aliases, baseUrl, inherited and malformed configurations', (t) => {
  for (const config of [
    '{"compilerOptions":{"baseUrl":"."}}',
    '{"extends":"../not-read.json"}',
    'bad config',
  ]) {
    const root = temporary(t);
    put(root, 'tsconfig.json', config);
    put(root, 'main.ts', "import 'could-be-local'; import 'node:fs';");
    assert.deepEqual(
      analyzeRepository(root).edges.map((e) => e.reason),
      ['alias', 'external_builtin'],
    );
  }
});

test('resolution can match a unique declaration file without claiming runtime implementation', (t) => {
  const root = temporary(t);
  put(root, 'main.ts', "import type {Thing} from './definitions';");
  put(root, 'definitions.d.ts', 'export interface Thing {}');
  const edge = analyzeRepository(root).edges[0];
  assert.equal(edge.to, 'definitions.d.ts');
  assert.equal(edge.resolution, 'resolved');
  assert.equal(
    analyzeRepository(root).modules.find((m) => m.path === 'main.ts').imports[0]
      .type_only,
    true,
  );
});

test('resolution normalizes root and trailing-slash directory indexes without inventing filename alternatives', (t) => {
  const root = temporary(t);
  put(root, 'src/main.ts', "import '..'; import '../folder/';");
  put(root, 'index.ts', 'export {}');
  put(root, 'folder/index.d.ts', 'export interface X {}');
  put(root, '..ts', 'export {}');
  assert.deepEqual(
    analyzeRepository(root).edges.map((e) => e.to),
    ['index.ts', 'folder/index.d.ts'],
  );
});
