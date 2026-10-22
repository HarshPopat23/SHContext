import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
export function put(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
export function fixture(t, { sources = true, partial = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shcontext generation '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(
    root,
    'shcontext.config.json',
    JSON.stringify({
      version: 1,
      provider: { id: 'openai', model: 'test-model' },
    }),
  );
  if (sources) {
    put(
      root,
      'src/core/normalize.ts',
      `export function normalize(value: string) { return value.trim().toLowerCase(); }\n`,
    );
    put(
      root,
      'src/api.ts',
      `import { normalize } from './core/normalize';\nimport missing from './missing';\nimport fs from 'node:fs';\nexport const greet = (name: string) => 'Hello ' + normalize(name);\n`,
    );
    put(
      root,
      'tests/normalize.test.ts',
      `import assert from 'node:assert/strict';\nimport { normalize } from '../src/core/normalize';\nassert.equal(normalize(' A '), 'a');\n`,
    );
  }
  if (partial) {
    put(root, 'src/legacy.py', 'UNSUPPORTED_BODY_DO_NOT_SEND = True\n');
    put(root, 'src/broken.ts', 'INVALID_BODY_DO_NOT_SEND function {\n');
    put(root, 'src/.env', 'EXCLUDED_BODY_DO_NOT_SEND');
    put(root, 'src/image.png', Buffer.from([0, 1, 2]));
  }
  return root;
}
export function draftFor(input) {
  const own = input.sources.map((source) => source.evidence_id);
  const child = input.children.flatMap((child) =>
    child.purpose.flatMap((claim) => claim.evidence_ids),
  );
  const ids = [...new Set([...own, ...child])];
  const claim = (text, evidence_ids) => ({
    kind: 'observed',
    text,
    evidence_ids,
    rationale: null,
  });
  const describe = (source) =>
    source.path.endsWith('normalize.ts')
      ? 'Trims surrounding whitespace and converts the string to lowercase.'
      : source.path.endsWith('api.ts')
        ? 'Formats a greeting with the normalized name.'
        : source.path.endsWith('.test.ts')
          ? 'Asserts that normalization trims and lowercases a padded uppercase input.'
          : 'Declares repository configuration settings.';
  return {
    purpose: [
      {
        kind: 'inference',
        text:
          input.source_path === 'src/core'
            ? 'Provides string normalization for callers.'
            : 'Groups inspected implementation, configuration or test responsibilities.',
        evidence_ids: ids,
        rationale: 'Based on the supplied bodies and child summaries.',
      },
    ],
    files: input.sources.map((source) => ({
      path: source.path,
      claims: [claim(describe(source), [source.evidence_id])],
    })),
    feature_flows: [],
    tests: input.sources
      .filter((source) => source.path.endsWith('.test.ts'))
      .map((source) => ({
        path: source.path,
        text: 'Inspects the assertion that a padded uppercase input normalizes to lowercase.',
        evidence_ids: [source.evidence_id],
      })),
    uncertainty: [
      'Runtime execution and behavior outside inspected bodies are not established.',
    ],
  };
}
export function fakeProvider(transform) {
  const calls = [];
  return {
    identity: { id: 'openai', model: 'test-model' },
    calls,
    async generate(request) {
      const input = JSON.parse(
        request.input.split('\nThe preceding response')[0],
      );
      calls.push({ request, input });
      const draft = draftFor(input);
      return transform ? transform(draft, input, request, calls.length) : draft;
    },
  };
}
