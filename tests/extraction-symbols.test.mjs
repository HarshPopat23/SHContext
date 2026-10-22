import assert from 'node:assert/strict';
import test from 'node:test';
import { extract } from './helpers/extraction.mjs';

test('symbols include declarations, assigned functions/classes, methods and TS types', () => {
  const source = `export function outer() { function inner() {} return inner; }
const arrow = () => 1;
class Local { constructor() {} method() {} #private() {} }
export class Public { static run() {} }
export interface Thing { name: string }
export type Alias = Thing;
export enum Choice { A }
export namespace Tools { export function nested() {} }
const Created = class {};
const {left, right: renamed} = sourceObject;`;
  const symbols = extract(source).analysis.symbols;
  assert.deepEqual(
    symbols.map((s) => [s.name, s.kind, s.exported]),
    [
      ['outer', 'function', true],
      ['inner', 'function', false],
      ['arrow', 'function', false],
      ['Local', 'class', false],
      ['Local.constructor', 'function', false],
      ['Local.method', 'function', false],
      ['Local.#private', 'function', false],
      ['Public', 'class', true],
      ['Public.run', 'function', false],
      ['Thing', 'interface', true],
      ['Alias', 'type', true],
      ['Choice', 'enum', true],
      ['Tools', 'namespace', true],
      ['nested', 'function', false],
      ['Created', 'class', false],
      ['left', 'variable', false],
      ['renamed', 'variable', false],
    ],
  );
  assert.deepEqual(
    symbols.map((s) => s.id),
    symbols.map((_, i) => `S${i + 1}`),
  );
});
test('exports preserve aliases, anonymous defaults, type-only and namespace re-exports', () => {
  const { analysis, module } = extract(
    `function local() {}\nexport {local as publicName};\nexport type {Thing as Shape} from './types';\nexport * as api from './api';\nexport default () => 1;`,
  );
  assert.deepEqual(
    module.exports.map((e) => [e.name, e.local, e.kind, e.type_only]),
    [
      ['publicName', 'local', 'local', false],
      ['Shape', null, 're-export', true],
      ['api', null, 're-export', false],
      ['default', null, 'default', false],
    ],
  );
  assert.deepEqual(
    analysis.symbols.map((s) => [s.name, s.exported]),
    [
      ['local', true],
      [null, true],
    ],
  );
});
test('exports mark the actual lexical binding without exporting same-named nested symbols', () => {
  const result = extract(
    `function item() {}\nfunction outer() { function item() {} return item; }\nexport {item};`,
  );
  assert.deepEqual(
    result.analysis.symbols
      .filter((s) => s.name === 'item')
      .map((s) => s.exported),
    [true, false],
  );
});
test('CommonJS exports recognize direct assignments and object literals without evaluating code', () => {
  const { analysis, module } = extract(
    `function fn() {}\nexports.fn = fn;\nmodule.exports.named = class Named {};\nmodule.exports = { fn, arrow: () => 1 };`,
    'source.cjs',
  );
  assert.deepEqual(
    module.exports.map((e) => e.name),
    ['fn', 'named', 'module.exports', 'fn', 'arrow'],
  );
  assert.ok(analysis.symbols.find((s) => s.name === 'fn').exported);
  assert.ok(analysis.symbols.find((s) => s.name === 'arrow').exported);
});
test('syntax scope includes JS/TS extension variants, ambient signatures and TS import/export equals', () => {
  for (const [path, source] of Object.entries({
    'view.jsx': 'export const View = () => <div/>;',
    'view.tsx': 'export const View = (n: number) => <div>{n}</div>;',
    'source.mjs': 'export default class {}',
    'source.mts': 'export const value: number = 1;',
    'source.cts': "import item = require('./other'); export = item;",
    'source.d.ts': 'export declare function declared(value: string): void;',
    'source.d.mts': 'export interface Declaration {}',
  }))
    assert.ok(
      extract(source, path).analysis.symbols.length > 0 ||
        path.endsWith('.cts'),
      path,
    );
  const result = extract(
    "import item = require('./other'); export = item;",
    'source.cts',
  );
  assert.equal(result.module.imports[0].local, 'item');
  assert.equal(result.module.exports[0].name, 'export=');
});
test('ranges retain raw UTF-8 offsets with BOM, emoji, CRLF and Unicode line separators', () => {
  const source =
    '\ufeffconst emoji = "😀";\r\nimport { value } from "./value.ts";\u2028export function run() {}';
  const { analysis } = extract(source);
  const reference = analysis.references[0];
  const bytes = Buffer.from(source);
  assert.equal(
    bytes.subarray(reference.start_byte, reference.end_byte).toString(),
    'import { value } from "./value.ts";',
  );
  assert.deepEqual(
    [reference.evidence.start_line, reference.evidence.end_line],
    [2, 2],
  );
  assert.deepEqual(analysis.symbols.find((s) => s.name === 'run').range, {
    start_line: 3,
    end_line: 3,
  });
});
test('ranges and IDs are stable for repeated extraction; anonymous callbacks are outside declared symbol scope', () => {
  const source = 'const fn = () => [1].map(() => 2);';
  assert.deepEqual(extract(source), extract(source));
  assert.deepEqual(
    extract(source).analysis.symbols.map((s) => s.name),
    ['fn'],
  );
});

test('symbols retain functions and classes wrapped in TypeScript assertions without duplicates', () => {
  const { analysis } = extract(
    'export const fn = (() => 1) satisfies () => number;\nexport const Class = (class {}) as object;\nexport default (() => 2) as () => number;',
  );
  assert.deepEqual(
    analysis.symbols.map((s) => [s.name, s.kind, s.exported]),
    [
      ['fn', 'function', true],
      ['Class', 'class', true],
      [null, 'function', true],
    ],
  );
});
test('symbols can represent anonymous or empty-named methods without rejecting valid syntax', () => {
  const { analysis } = extract('const obj = { ""() {}, [computed]() {} };');
  assert.equal(analysis.symbols.filter((s) => s.kind === 'function').length, 2);
});

test('exports inside TypeScript namespaces do not become file-level exports', () => {
  const { module } = extract(
    "namespace Internal { export import value = require('./value'); }\nexport namespace Public { export const nested = 1; }",
  );
  assert.deepEqual(
    module.exports.map((e) => e.name),
    ['Public'],
  );
});

test('syntax scope includes private function fields and type-only default interfaces', () => {
  const { analysis, module } = extract(
    'class Class { #handler = () => 1; }\nexport default interface Definition { value: string }',
  );
  assert.ok(
    analysis.symbols.some(
      (s) => s.name === '#handler' && s.kind === 'function',
    ),
  );
  assert.equal(module.exports[0].type_only, true);
  assert.equal(
    analysis.symbols.find((s) => s.name === 'Definition').exported,
    true,
  );
});

test('CommonJS exports select the lexical local binding rather than a same-named global declaration', () => {
  const { analysis } = extract(
    'function same() {}\nfunction outer() { function same() {} exports.value = same; }',
    'source.cjs',
  );
  assert.deepEqual(
    analysis.symbols.filter((s) => s.name === 'same').map((s) => s.exported),
    [false, true],
  );
});
