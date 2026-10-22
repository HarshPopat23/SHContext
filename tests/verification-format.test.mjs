import assert from 'node:assert/strict';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildRepository,
  verifyRepository,
  countInventory,
} from '../dist/index.js';
import { renderFolder } from '../dist/generation/render.js';
import { inputIdentity, policyIdentity } from '../dist/scanner/identity.js';
import {
  built,
  fixture,
  fakeProvider,
  put,
  editOutput,
  readManifest,
  saveManifest,
  hash,
} from './helpers/verification.mjs';

for (const [name, edit] of [
  ['required section', (s) => s.replace('## Tests', '## Missing')],
  ['duplicate section', (s) => s.replace('## Tests', '## Purpose')],
  ['front matter', (s) => s.replace('schema_version: 1', 'schema_version: 2')],
  [
    'wrong folder',
    (s) => s.replace("source_path: '.'", "source_path: 'other'"),
  ],
  [
    'invalid coverage',
    (s) => s.replace("coverage: 'complete'", "coverage: 'partial'"),
  ],
  [
    'dangling citation',
    (s) => s.replace(/\[E[0-9]+\]\(#e[0-9]+\)/, '[E99999](#e99999)'),
  ],
  [
    'wrong anchor',
    (s) => s.replace(/\[E([0-9]+)\]\(#e[0-9]+\)/, '[E$1](#evil)'),
  ],
  [
    'unsafe link',
    (s) => s.replace('(../shcontext.config.json)', '(javascript:bad)'),
  ],
  [
    'escaping link',
    (s) => s.replace('(../shcontext.config.json)', '(../../outside.json)'),
  ],
  ['child link', (s) => s.replace('(src/CONTEXT.md)', '(missing/CONTEXT.md)')],
  ['file inventory', (s) => s.replace(/- \[shcontext.*?\n\n/, '')],
  ['counts', (s) => s.replace('| files | 4 |', '| files | 999 |')],
  [
    'missing file responsibility',
    (s) =>
      s.replace(
        /Declares repository configuration settings\\\. \[E[0-9]+\]\(#e[0-9]+\)/,
        'No supported responsibility',
      ),
  ],
  [
    'HTML injection',
    (s) =>
      s.replace('Groups inspected', '<script>bad</script> Groups inspected'),
  ],
  [
    'test execution claim',
    (s) => s.replace('Inspected only; not executed.', 'Executed and passed.'),
  ],
])
  test(`rehashed ${name} cannot pass format validation`, async (t) => {
    const { root } = await built(t);
    const path =
      name === 'test execution claim'
        ? 'context/tests/CONTEXT.md'
        : 'context/CONTEXT.md';
    const before = readFileSync(join(root, path), 'utf8'),
      after = edit(before);
    assert.notEqual(
      after,
      before,
      'negative control must actually modify the artifact',
    );
    editOutput(root, path, () => after);
    assert.equal(verifyRepository(root).state, 'invalid');
  });

test('matching-source evidence outside line bounds is invalid, while changed-source references are stale', async (t) => {
  const { root } = await built(t);
  editOutput(root, 'context/src/core/CONTEXT.md', (s) =>
    s.replace(
      /(\[src\/core\/normalize\\\.ts\][^\n]* — lines 1–)[0-9]+/,
      (_, prefix) => prefix + '9999',
    ),
  );
  assert.equal(verifyRepository(root).state, 'invalid');
  put(root, 'src/core/normalize.ts', 'export const changed = 1;');
  assert.equal(verifyRepository(root).state, 'stale');
});

test('missing eligible output and fabricated manifest omissions are invalid', async (t) => {
  const { root } = await built(t);
  rmSync(join(root, 'context/src/core/CONTEXT.md'));
  assert.equal(verifyRepository(root).state, 'invalid');
  const manifest = readManifest(root);
  manifest.directories = manifest.directories.filter(
    (d) => d.path !== 'src/core',
  );
  manifest.outputs = manifest.outputs.filter(
    (o) => o.path !== 'context/src/core/CONTEXT.md',
  );
  saveManifest(root, manifest);
  assert.equal(verifyRepository(root).state, 'invalid');
});

test('a coherently fabricated inventory cannot omit a currently eligible folder and still be fresh', async (t) => {
  const root = fixture(t, { sources: false });
  put(root, '.shcontextignore', 'shcontext.config.json\n.shcontextignore\n');
  put(root, 'empty/.gitignore', '');
  const { bundle } = await buildRepository(root, { provider: fakeProvider() });
  assert.equal(verifyRepository(root).state, 'fresh');
  bundle.inventory.entries = bundle.inventory.entries.filter(
    (e) => e.path !== 'empty/' && e.path !== 'empty/.gitignore',
  );
  bundle.inventory.counts = countInventory(bundle.inventory.entries);
  const manifest = bundle.manifest;
  manifest.directories = manifest.directories.filter((d) => d.path !== 'empty');
  manifest.files = manifest.files.filter((f) => f.path !== 'empty/.gitignore');
  manifest.selection.control_files = manifest.selection.control_files.filter(
    (f) => f.path !== 'empty/.gitignore',
  );
  const policy = policyIdentity(
    manifest.selection.configuration,
    manifest.selection.control_files,
    manifest.generation.default_policy,
    manifest.generation.detector,
  );
  manifest.input_id = inputIdentity(policy, bundle.inventory.entries);
  bundle.inventory.input_id = manifest.input_id;
  const folder = bundle.folders.find((f) => f.source_path === '.');
  folder.input_id = manifest.input_id;
  folder.children = [];
  folder.counts = bundle.inventory.counts;
  put(root, 'context/CONTEXT.md', renderFolder(folder));
  put(
    root,
    'context/.shcontext/report.json',
    JSON.stringify(bundle.inventory, null, 2) + '\n',
  );
  rmSync(join(root, 'context/empty'), { recursive: true });
  manifest.outputs = manifest.outputs.filter(
    (o) => o.path !== 'context/empty/CONTEXT.md',
  );
  for (const output of manifest.outputs)
    output.sha256 = hash(readFileSync(join(root, output.path)));
  saveManifest(root, manifest);
  assert.equal(verifyRepository(root).state, 'stale');
});

test('a deliberately false explanation with valid citations can be mechanically fresh; review is separate', async (t) => {
  const root = fixture(t);
  await buildRepository(root, {
    provider: fakeProvider((draft) => {
      draft.purpose[0].text = 'Launches spacecraft.';
      return draft;
    }),
  });
  assert.equal(verifyRepository(root).state, 'fresh');
  assert.match(
    readFileSync(join(root, 'context/CONTEXT.md'), 'utf8'),
    /Launches spacecraft/,
  );
});

test('escaped unusual filenames and multiple observed/inferred responsibilities remain valid', async (t) => {
  const root = fixture(t);
  put(root, "odd space/é(a)#&'x.ts", 'export const value=1;');
  await buildRepository(root, {
    provider: fakeProvider((draft) => {
      for (const file of draft.files) {
        file.claims.push({
          kind: 'inference',
          text: 'May support callers.',
          evidence_ids: file.claims[0].evidence_ids,
          rationale: 'Based on the inspected declaration.',
        });
      }
      return draft;
    }),
  });
  assert.equal(verifyRepository(root).state, 'fresh');
});

test('empty analyzed files receive no impossible source range or invented behavior', async (t) => {
  const root = fixture(t);
  put(root, 'empty.ts', '');
  const { bundle } = await buildRepository(root, { provider: fakeProvider() });
  assert.equal(verifyRepository(root).state, 'fresh');
  const file = bundle.folders
    .find((f) => f.source_path === '.')
    .files.find((f) => f.path === 'empty.ts');
  assert.deepEqual(file.claims, []);
  assert.deepEqual(file.limitations, ['Empty file; no behavioral evidence.']);
  assert.ok(
    !bundle.folders
      .flatMap((f) => f.evidence)
      .some((e) => e.path === 'empty.ts'),
  );
});

test('duplicate JSON metadata keys are rejected', async (t) => {
  const { root } = await built(t);
  const manifest = readManifest(root);
  put(
    root,
    'context/.shcontext/manifest.json',
    JSON.stringify(manifest).replace(
      '"schema_version":1',
      '"schema_version":1,"schema_version":1',
    ),
  );
  assert.equal(verifyRepository(root).state, 'invalid');
});

test('quoted folder metadata and escaped bracket filenames validate through canonical links', async (t) => {
  const root = fixture(t);
  put(root, "O'Brien/array[0].ts", 'export const value = 1;');
  await buildRepository(root, { provider: fakeProvider() });
  assert.equal(verifyRepository(root).state, 'fresh');
});

test('recorded readable byte counts must agree with budgets and matching source bytes', async (t) => {
  const { root } = await built(t);
  const original = readFileSync(
    join(root, 'context/.shcontext/report.json'),
    'utf8',
  );
  for (const bytes of [1, 1048577]) {
    editOutput(root, 'context/.shcontext/report.json', () => {
      const report = JSON.parse(original);
      report.entries.find((e) => e.path === 'src/core/normalize.ts').bytes =
        bytes;
      return JSON.stringify(report, null, 2) + '\n';
    });
    assert.equal(verifyRepository(root).state, 'invalid');
  }
});
