import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['build', 'update', 'verify', 'query', 'benchmark'].map(
  (name) => `context-${name}`,
);
const read = (base, path) => fs.readFileSync(join(base, path), 'utf8');

// Check this package's deliberately narrow frontmatter dialect, not arbitrary YAML.
function inspect(base) {
  const manifest = JSON.parse(read(base, '.claude-plugin/plugin.json'));
  const market = JSON.parse(read(base, '.claude-plugin/marketplace.json'));
  assert.equal(manifest.name, 'shcontext');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, 'MIT');
  assert.equal(market.name, 'shcontext-workflows');
  assert.deepEqual(market.plugins, [
    { name: manifest.name, source: './', strict: true },
  ]);
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(manifest.hooks, undefined);
  assert.deepEqual(
    fs
      .readdirSync(join(base, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
    [...names].sort(),
  );
  return names.map((name) => {
    const path = join(base, 'skills', name, 'SKILL.md');
    assert.ok(
      fs.lstatSync(path).isFile() && !fs.lstatSync(path).isSymbolicLink(),
    );
    const text = fs.readFileSync(path, 'utf8');
    const match =
      /^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: >-\r?\n((?:  .+\r?\n)+)---\r?\n/.exec(
        text,
      );
    assert.ok(match, `Invalid package frontmatter: ${name}`);
    assert.equal(match[1], name);
    const description = match[2]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join(' ')
      .trim();
    assert.ok(description.length > 80 && description.length <= 1024);
    assert.ok(!text.includes('TODO'));
    const ui = read(base, `skills/${name}/agents/openai.yaml`);
    assert.ok(ui.includes(`$${name}`));
    assert.ok(ui.includes('short_description:'));
    return { name, description };
  });
}

test('plugin discovers exactly five complete, bounded skill descriptions with matching UI metadata', () => {
  assert.equal(inspect(root).length, 5);
});

test('package inspection fails on missing skills, substituted names and escaping marketplace sources', (t) => {
  const box = fs.mkdtempSync(join(tmpdir(), 'shcontext skill controls '));
  t.after(() => fs.rmSync(box, { recursive: true, force: true }));
  for (const folder of ['skills', '.claude-plugin'])
    fs.cpSync(join(root, folder), join(box, folder), { recursive: true });
  assert.equal(inspect(box).length, 5); // Known valid control before each mutation.
  const path = join(box, 'skills/context-query/SKILL.md');
  const original = fs.readFileSync(path, 'utf8');
  fs.unlinkSync(path);
  assert.throws(() => inspect(box));
  fs.writeFileSync(
    path,
    original.replace('name: context-query', 'name: other'),
  );
  assert.throws(() => inspect(box));
  fs.writeFileSync(path, original);
  assert.equal(inspect(box).length, 5);
  const market = JSON.parse(read(box, '.claude-plugin/marketplace.json'));
  market.plugins[0].source = '../outside';
  fs.writeFileSync(
    join(box, '.claude-plugin/marketplace.json'),
    JSON.stringify(market),
  );
  assert.throws(() => inspect(box));
});

test('activation fixtures cover positive and negative boundaries for every skill without acting as a fake router', () => {
  const cases = JSON.parse(read(root, 'tests/fixtures/skills/activation.json'));
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  for (const item of cases) {
    assert.ok(item.id && item.request.trim());
    assert.equal(new Set(item.expected).size, item.expected.length);
    assert.ok(item.expected.every((name) => names.includes(name)));
  }
  for (const name of names) {
    assert.ok(cases.filter((item) => item.expected.includes(name)).length >= 3);
    assert.ok(
      cases.filter((item) => !item.expected.includes(name)).length >= 3,
    );
  }
});

test('recorded independent routing decisions match the current metadata and request corpus', () => {
  const metadata = inspect(root);
  const cases = JSON.parse(read(root, 'tests/fixtures/skills/activation.json'));
  const report = JSON.parse(
    read(root, 'docs/examples/skills/routing-results.json'),
  );
  const hash = (value) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(
    report.metadata_sha256,
    hash(metadata),
    'Reevaluate changed skill descriptions.',
  );
  assert.equal(
    report.cases_sha256,
    hash(cases),
    'Reevaluate changed activation requests.',
  );
  assert.equal(report.predictions.length, cases.length);
  assert.equal(
    new Set(report.predictions.map((item) => item.id)).size,
    cases.length,
  );
  let matched = 0;
  for (const item of cases) {
    const prediction = report.predictions.find((value) => value.id === item.id);
    assert.ok(prediction);
    assert.deepEqual(
      [...prediction.selected].sort(),
      [...item.expected].sort(),
    );
    matched++;
  }
  assert.equal(report.total, cases.length);
  assert.equal(report.matched, matched);
  // This validates a bound historical record; it does not rerun a model in CI.
});
