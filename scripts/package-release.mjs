import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2),
  clean = args.includes('--require-clean');
const positionals = args.filter((x) => x !== '--require-clean');
assert.equal(
  positionals.length,
  1,
  'Usage: npm run release:pack -- <new-output-directory> [--require-clean]',
);
const out = resolve(positionals[0]);
const location = relative(root, out);
assert.ok(
  location === '..' || location.startsWith('..' + sep) || isAbsolute(location),
  'Release artifacts must be outside the source checkout.',
);
assert.ok(
  !fs.existsSync(out),
  'Output directory already exists; artifacts will not be overwritten.',
);
const metadata = JSON.parse(fs.readFileSync(join(root, 'package.json')));
assert.match(metadata.version, /^\d+\.\d+\.\d+-alpha\.\d+$/);
const run = (command, argv) => {
  const result = spawnSync(command, argv, {
    cwd: root,
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const revision = run('git', ['rev-parse', 'HEAD']);
const dirty = run('git', ['status', '--porcelain']).length > 0;
if (clean)
  assert.equal(
    dirty,
    false,
    'Refuse to publish artifacts from a dirty source checkout.',
  );
fs.mkdirSync(dirname(out), { recursive: true });
fs.mkdirSync(out);
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run release:pack.');
const packed = JSON.parse(
  run(process.execPath, [npm, 'pack', '--json', '--pack-destination', out]),
)[0];
const required = [
  'dist/cli/index.js',
  'dist/index.d.ts',
  'scripts/ci-freshness.mjs',
  'examples/offline-demo.mjs',
  'docs/quickstart.md',
  'LICENSE',
  '.claude-plugin/plugin.json',
];
for (const path of required)
  assert.ok(
    packed.files.some((file) => file.path === path),
    `Missing release file: ${path}`,
  );
for (const skill of ['build', 'update', 'verify', 'query', 'benchmark'])
  assert.ok(
    packed.files.some(
      (file) => file.path === `skills/context-${skill}/SKILL.md`,
    ),
  );
const digest = (file) =>
  createHash('sha256')
    .update(fs.readFileSync(join(out, file)))
    .digest('hex');
const manifest = {
  schema_version: 1,
  name: metadata.name,
  version: metadata.version,
  tag: `v${metadata.version}`,
  source_revision: revision,
  source_dirty: dirty,
  node: process.version,
  format: 'npm tarball; registry publication disabled',
  artifact: {
    filename: packed.filename,
    sha256: digest(packed.filename),
    bytes: fs.statSync(join(out, packed.filename)).size,
  },
  limitations: [
    'Alpha: controlled evaluation is not live-model quality or real billing evidence.',
    'Prepared source checkout is required for benchmark harnesses.',
    'Public publication follows review and merge; this command only builds local artifacts.',
  ],
};
fs.writeFileSync(
  join(out, 'release-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
fs.writeFileSync(
  join(out, 'release-notes.md'),
  `# SHContext ${metadata.version}\n\nInstall the tarball with Node 22.14+ (22 line) or Node 24 and npm 10+. See the included docs/quickstart.md for build/change/update/verify and offline demo.\n\nSource: ${revision}; dirty: ${dirty}. Verify SHA256SUMS before installation. Dependencies require npm access at install time.\n\nFive skills and a Claude Code plugin are included. The benchmark harness requires a complete source checkout. Live provider quality, tokens and billing are not established by scripted controls. This alpha has not been published by this packaging command.\n`,
);
const files = [packed.filename, 'release-manifest.json', 'release-notes.md'];
fs.writeFileSync(
  join(out, 'SHA256SUMS'),
  files.map((file) => `${digest(file)}  ${file}\n`).join(''),
);
console.log(JSON.stringify(manifest, null, 2));
console.log('RELEASE PACKAGE READY');
