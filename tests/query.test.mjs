import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { queryRepository } from '../dist/index.js';
import { fixture, built, put } from './helpers/query.mjs';
import { hash, legacyOutput } from './helpers/verification.mjs';
const questions = JSON.parse(
  fs.readFileSync(
    new URL('./fixtures/query/questions.json', import.meta.url),
    'utf8',
  ),
);
for (const item of questions)
  test(`query retrieves expected evidence: ${item.question}`, async (t) => {
    const root = await built(t),
      result = queryRepository(root, item.question, { limit: 10 });
    assert.equal(result.context.state, 'fresh');
    for (const path of item.paths)
      assert.ok(
        result.matches.some((match) => match.path === path),
        JSON.stringify(result.matches),
      );
    for (const path of item.neighbors ?? [])
      assert.ok(result.matches.some((match) => match.path === path));
    if (!item.paths.length) {
      assert.equal(result.status, 'no_match');
      assert.equal(result.matches.length, 0);
      assert.match(result.answer, /does not establish.*absent/);
    }
    for (const match of result.matches)
      for (const ref of match.references) {
        assert.equal(ref.sha256, hash(fs.readFileSync(join(root, ref.path))));
        assert.ok(
          ref.end_line <=
            fs
              .readFileSync(join(root, ref.path), 'utf8')
              .split(/\r\n|[\n\r\u2028\u2029]/).length,
        );
      }
  });
test('answers include declarations, bounded source lines, summaries and explicit unresolved references', async (t) => {
  const root = await built(t),
    result = queryRepository(root, 'Where is authentication handled?', {
      limit: 10,
    });
  assert.match(result.answer, /verifySession/);
  assert.match(result.answer, /expiresAt <= now/);
  assert.ok(
    result.summaries.some(
      (summary) => summary.path === 'context/src/auth/CONTEXT.md',
    ),
  );
  assert.ok(
    result.relationships.some(
      (edge) => edge.resolution === 'unresolved' && edge.to === null,
    ),
  );
  assert.match(result.answer, /unresolved.*no confirmed file target/);
  assert.ok(
    !result.matches.some((match) => match.path.includes('not-configured')),
  );
});
test('incoming and outgoing resolved dependencies traverse cyclic graphs with depth and result bounds', async (t) => {
  const root = fixture(t);
  put(root, 'cycle/a.ts', "import './b'; export const uniqueAnchor=1;\n");
  put(
    root,
    'cycle/b.ts',
    "import './a'; import './c'; export const second=2;\n",
  );
  put(root, 'cycle/c.ts', 'export const third=3;\n');
  const shallow = queryRepository(root, 'uniqueAnchor', {
    depth: 0,
    limit: 10,
  });
  assert.ok(
    !shallow.matches.some(
      (match) =>
        match.path === 'cycle/c.ts' && match.reasons.includes('dependency'),
    ),
  );
  const deep = queryRepository(root, 'uniqueAnchor', { depth: 2, limit: 10 });
  assert.ok(
    deep.matches.some(
      (match) =>
        match.path === 'cycle/c.ts' && match.reasons.includes('dependency'),
    ),
  );
  const bounded = queryRepository(root, 'uniqueAnchor', { depth: 3, limit: 1 });
  assert.equal(bounded.matches.length, 1);
  assert.equal(bounded.traversal.truncated, true);
});
test('summary-only retrieval is labeled as generated navigation and source is still inspected', async (t) => {
  const root = await built(t);
  const result = queryRepository(root, 'signature-prefix', {
    depth: 0,
    limit: 5,
  });
  assert.ok(result.matches.some((match) => match.reasons.includes('summary')));
  assert.ok(result.matches.every((match) => match.references.length));
  assert.match(result.answer, /review against source/);
  assert.match(
    result.summaries.find((summary) => summary.source_path === 'src/auth')
      .excerpt,
    /Inference:/,
  );
});
test('legacy owned Markdown remains searchable without requiring an update or model', async (t) => {
  const root = await built(t);
  legacyOutput(root);
  const result = queryRepository(root, 'verifySession');
  assert.equal(result.status, 'answered');
  assert.ok(result.summaries.length);
  assert.ok(
    result.limitations.some((text) => text.includes('Legacy Markdown')),
  );
});
test('unsupported files are inventory-only matches, never source behavior', async (t) => {
  const root = await built(t);
  put(root, 'legacy/authentication.py', 'def authenticate(): return True\n');
  const result = queryRepository(root, 'legacy/authentication.py', {
    depth: 0,
  });
  const item = result.matches.find(
    (match) => match.path === 'legacy/authentication.py',
  );
  assert.equal(item.inspection, 'inventory-only');
  assert.equal(item.excerpt, '');
  assert.deepEqual(item.references, []);
  assert.match(result.answer, /behavior not analyzed/);
  assert.equal(result.status, 'context_stale');
});

test('summary-only matches promote cited files, not every file or unsupported inventory entry in their folder', async (t) => {
  const root = fixture(t);
  put(
    root,
    'utilities/size.ts',
    'export function size(value:string){return value.length;}\n',
  );
  put(root, 'utilities/unrelated.ts', 'export const unrelated=1;\n');
  put(root, 'utilities/legacy.py', 'VALUE=1\n');
  const { buildRepository } = await import('../dist/index.js');
  const { fakeProvider } = await import('./helpers/verification.mjs');
  await buildRepository(root, {
    provider: fakeProvider((draft) => {
      const file = draft.files.find(
        (file) => file.path === 'utilities/size.ts',
      );
      if (file)
        file.claims[0].text =
          'Returns the UTF-16 code-unit count of the input string.';
      return draft;
    }),
  });
  const result = queryRepository(root, 'Where is code-unit counting?', {
    depth: 0,
  });
  assert.deepEqual(
    result.matches.map((item) => item.path),
    ['utilities/size.ts'],
  );
  assert.ok(result.matches[0].reasons.includes('summary'));
});
