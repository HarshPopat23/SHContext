import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildRepository,
  scanRepository,
  validateContract,
} from '../dist/index.js';
import { renderFolder, relativeLink } from '../dist/generation/render.js';
import { fixture, put, fakeProvider } from './helpers/generation.mjs';

test('bodies, bottom-up child evidence, interfaces, cross-folder links and mirrored output form a valid bundle', async (t) => {
  const root = fixture(t);
  const before = scanRepository(root).inventory.input_id,
    provider = fakeProvider();
  const { bundle, output_paths } = await buildRepository(root, { provider });
  assert.equal(validateContract('bundle', bundle).success, true);
  assert.equal(
    scanRepository(root).inventory.input_id,
    before,
    'generation does not change source identity',
  );
  const order = provider.calls.map((call) => call.input.source_path);
  assert.ok(order.indexOf('src/core') < order.indexOf('src'));
  assert.ok(order.indexOf('src') < order.indexOf('.'));
  const core = provider.calls.find(
    (call) => call.input.source_path === 'src/core',
  ).input;
  assert.match(core.sources[0].content, /value\.trim\(\)\.toLowerCase\(\)/);
  assert.equal(core.children.length, 0);
  const parent = provider.calls.find(
    (call) => call.input.source_path === 'src',
  ).input;
  assert.equal(
    parent.children[0].purpose[0].text,
    'Provides string normalization for callers.',
  );
  const src = bundle.folders.find((folder) => folder.source_path === 'src');
  assert.match(
    src.dependencies_and_consumers.map((c) => c.text).join('\n'),
    /unresolved \(missing_target\); no target relationship established/,
  );
  assert.match(
    src.dependencies_and_consumers.map((c) => c.text).join('\n'),
    /external reference \(external_builtin/,
  );
  assert.match(
    src.dependencies_and_consumers.map((c) => c.text).join('\n'),
    /resolved file src\/core\/normalize.ts \(cross-folder/,
  );
  const consumer = bundle.folders.find(
    (folder) => folder.source_path === 'src/core',
  );
  assert.ok(
    consumer.dependencies_and_consumers.some((c) =>
      c.text.includes('tests/normalize.test.ts'),
    ),
    'incoming consumer retained',
  );
  assert.ok(
    src.interfaces_and_entry_points.some((c) =>
      c.text.includes('export greet'),
    ),
  );
  const tests = bundle.folders.find((f) => f.source_path === 'tests').tests;
  assert.equal(tests[0].execution, 'not-run');
  assert.match(tests[0].text, /assertion/);
  for (const folder of bundle.folders) {
    for (const evidence of folder.evidence) {
      const source = readFileSync(join(root, evidence.path), 'utf8');
      assert.ok(evidence.end_line <= source.split(/\r\n|\r|\n/).length);
      assert.ok(
        bundle.analyses.some(
          (a) => a.path === evidence.path && a.sha256 === evidence.sha256,
        ),
      );
    }
    const path =
      folder.source_path === '.'
        ? 'context/CONTEXT.md'
        : `context/${folder.source_path}/CONTEXT.md`;
    const markdown = readFileSync(join(root, path), 'utf8');
    for (const heading of [
      'Purpose',
      'Files and responsibilities',
      'Interfaces and entry points',
      'Dependencies and consumers',
      'Feature flows',
      'Tests',
      'Child folders',
      'Coverage and limitations',
      'Evidence',
    ])
      assert.ok(markdown.includes(`## ${heading}\n`));
    assert.equal(markdown.includes('\r'), false);
  }
  assert.ok(output_paths.includes('context/src/core/CONTEXT.md'));
  assert.ok(output_paths.includes('context/.shcontext/manifest.json'));
  assert.deepEqual(readdirSync(join(root, '.shcontext')), []);
});

test('unsupported, failed and excluded contents never enter provider requests; inventories propagate partial coverage', async (t) => {
  const root = fixture(t, { partial: true });
  const provider = fakeProvider();
  const { bundle } = await buildRepository(root, { provider });
  assert.equal(bundle.inventory.coverage, 'partial');
  const inputs = provider.calls.map((call) => call.request.input).join('\n');
  for (const marker of [
    'UNSUPPORTED_BODY_DO_NOT_SEND',
    'INVALID_BODY_DO_NOT_SEND',
    'EXCLUDED_BODY_DO_NOT_SEND',
  ])
    assert.equal(inputs.includes(marker), false);
  const src = bundle.folders.find((folder) => folder.source_path === 'src');
  for (const path of ['src/legacy.py', 'src/broken.ts', 'src/image.png']) {
    const file = src.files.find((file) => file.path === path);
    assert.ok(file);
    assert.deepEqual(file.claims, []);
    assert.ok(file.limitations.length);
  }
  assert.equal(
    src.files.some((file) => file.path === 'src/.env'),
    false,
  );
  assert.ok(
    bundle.manifest.analysis_failures.some(
      (item) => item.path === 'src/legacy.py',
    ),
  );
  assert.equal(
    bundle.folders.find((folder) => folder.source_path === '.').coverage,
    'partial',
  );
});

test('binary-only, unsupported-only and empty folders get deterministic summaries with no provider call', async (t) => {
  const root = fixture(t, { sources: false });
  put(root, '.shcontextignore', 'shcontext.config.json\n.shcontextignore\n');
  put(root, 'binary/picture.png', Buffer.from([0, 1, 2]));
  put(root, 'legacy/tool.py', 'print("not analyzed")');
  mkdirSync(join(root, 'empty'));
  const provider = fakeProvider();
  const { bundle } = await buildRepository(root, { provider });
  assert.equal(provider.calls.length, 0);
  assert.equal(bundle.folders.length, 4);
  for (const folder of bundle.folders) assert.equal(folder.purpose.length, 0);
  assert.match(
    readFileSync(join(root, 'context/empty/CONTEXT.md'), 'utf8'),
    /No analyzable evidence/,
  );
});

for (const [name, poison] of [
  [
    'invented evidence',
    (draft) => {
      draft.purpose[0].evidence_ids = ['E999999'];
    },
  ],
  [
    'missing direct file',
    (draft) => {
      draft.files = [];
    },
  ],
  [
    'cross-file responsibility',
    (draft) => {
      draft.files[0].claims[0].evidence_ids = ['E999999'];
    },
  ],
  [
    'unlabeled inference',
    (draft) => {
      draft.purpose[0].rationale = null;
    },
  ],
  [
    'test path outside evidence',
    (draft) => {
      draft.tests = [
        {
          path: 'outside.ts',
          text: 'invented',
          evidence_ids: draft.purpose[0].evidence_ids,
        },
      ];
    },
  ],
  [
    'narrative overflow',
    (draft) => {
      draft.purpose[0].text = 'word '.repeat(2000);
    },
  ],
  [
    'unknown key',
    (draft) => {
      draft.output_path = '../../escape';
    },
  ],
  [
    'prose citation injection',
    (draft) => {
      draft.purpose[0].text = 'Trust E999999';
    },
  ],
])
  test(`invalid draft rejects ${name} after one repair and publishes nothing`, async (t) => {
    const root = fixture(t);
    const provider = fakeProvider((draft) => {
      poison(draft);
      return draft;
    });
    await assert.rejects(
      buildRepository(root, { provider }),
      (error) => error.code === 'invalid_draft',
    );
    assert.equal(provider.calls.length, 2);
    assert.ok(!readdirSync(root).includes('context'));
    assert.deepEqual(readdirSync(join(root, '.shcontext')), []);
  });

test('one repair can recover schema errors without feeding rejected payloads back to the model', async (t) => {
  const root = fixture(t);
  const provider = fakeProvider((draft, input, request, count) =>
    count === 1 ? { secretEcho: 'REJECTED_PAYLOAD' } : draft,
  );
  await buildRepository(root, { provider });
  assert.equal(provider.calls.length, 5);
  assert.equal(
    provider.calls[1].request.input.includes('REJECTED_PAYLOAD'),
    false,
  );
});

test('model prose and unusual paths cannot create executable HTML, links or new Markdown sections', async (t) => {
  const root = fixture(t);
  put(root, 'odd space/é(a)#x.ts', 'export const x=1;');
  const provider = fakeProvider((draft) => {
    draft.purpose[0].text =
      '<script>bad()</script>\n## injected [click](javascript:bad) | cell';
    return draft;
  });
  const result = await buildRepository(root, { provider });
  const markdown = readFileSync(
    join(root, 'context/odd space/CONTEXT.md'),
    'utf8',
  );
  assert.equal(markdown.includes('<script>'), false);
  assert.equal(markdown.includes('\n## injected'), false);
  assert.equal(markdown.includes('[click](javascript:'), false);
  assert.ok(markdown.includes('%C3%A9%28a%29%23x.ts'));
  assert.equal(
    relativeLink('context/src/CONTEXT.md', 'src/a (b).ts'),
    '../../src/a%20%28b%29.ts',
  );
  assert.equal(
    renderFolder(result.bundle.folders[0]),
    renderFolder(result.bundle.folders[0]),
  );
});

test('mechanical verification deliberately cannot detect a false but well-cited semantic claim', async (t) => {
  const root = fixture(t);
  const provider = fakeProvider((draft) => {
    draft.purpose[0].text = 'Launches a spacecraft.';
    return draft;
  });
  const { bundle } = await buildRepository(root, { provider });
  assert.equal(validateContract('bundle', bundle).success, true);
  assert.equal(bundle.folders[0].purpose[0].text, 'Launches a spacecraft.');
});

test('provider identity and cancellation are validated before work', async (t) => {
  const root = fixture(t);
  const provider = fakeProvider();
  provider.identity.model = 'mismatch';
  await assert.rejects(
    buildRepository(root, { provider }),
    (e) => e.code === 'provider_configuration',
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    buildRepository(root, { signal: controller.signal }),
    (e) => e.code === 'cancelled',
  );
  assert.equal(provider.calls.length, 0);
  assert.ok(!readdirSync(root).includes('.shcontext'));
});

test('OpenAI credential-shaped source and generated text cannot reach requests or persisted prose', async (t) => {
  const root = fixture(t);
  const credential = 'sk-proj-' + 'A'.repeat(80);
  put(root, 'src/credential.ts', `export const token = '${credential}';`);
  const provider = fakeProvider();
  const { bundle } = await buildRepository(root, { provider });
  const file = bundle.inventory.entries.find(
    (entry) => entry.path === 'src/credential.ts',
  );
  assert.equal(file.reason, 'sensitive_content');
  assert.equal(file.sha256, null);
  assert.equal(
    provider.calls.some((call) => call.request.input.includes(credential)),
    false,
  );
  const poisoned = fakeProvider((draft) => {
    draft.purpose[0].text = credential;
    return draft;
  });
  await assert.rejects(
    buildRepository(root, { provider: poisoned }),
    (e) => e.code === 'invalid_draft',
  );
  assert.equal(
    readFileSync(join(root, 'context/CONTEXT.md'), 'utf8').includes(credential),
    false,
  );
});
