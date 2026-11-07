import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { baseline, changed, put } from './helpers/update.mjs';

const read = (root, path) => fs.readFileSync(join(root, path), 'utf8');

// Committed context/ must produce small, mergeable diffs: an edit may only
// rewrite the summaries of the edited folder and its ancestors.
test('an edit leaves unrelated folders CONTEXT.md byte-identical', async (t) => {
  const { root } = await baseline(t);
  const untouched = [
    'src/CONTEXT.md',
    'src/core/CONTEXT.md',
    'tests/CONTEXT.md',
  ]
    .map((path) => `context/${path}`)
    .filter((path) => fs.existsSync(join(root, path)));
  assert.ok(untouched.length >= 2);
  const before = new Map(untouched.map((p) => [p, read(root, p)]));
  put(root, 'unrelated/info.ts', 'export const info = 2;\n');
  const result = await changed(root, ['unrelated', '.']);
  assert.deepEqual(result.reused, ['src', 'src/core', 'tests']);
  for (const [path, text] of before)
    assert.equal(read(root, path), text, `${path} changed without cause`);
});

test('summaries no longer embed the repository-wide input id', async (t) => {
  const { root } = await baseline(t);
  const manifest = JSON.parse(read(root, 'context/.shcontext/manifest.json'));
  for (const path of manifest.outputs
    .map((o) => o.path)
    .filter((p) => p.endsWith('CONTEXT.md'))) {
    const text = read(root, path);
    assert.ok(!text.includes('input_id'), path);
    assert.ok(!text.includes(manifest.input_id), path);
  }
  assert.match(manifest.input_id, /^sha256:/);
});
