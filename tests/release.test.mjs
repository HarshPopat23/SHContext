import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
test(
  'versioned release artifacts install into a clean consumer and complete the offline build/change/update/verify walkthrough',
  { timeout: 180000 },
  async (t) => {
    const box = fs.mkdtempSync(join(tmpdir(), 'shcontext release consumer '));
    t.after(() => fs.rmSync(box, { recursive: true, force: true }));
    const npm = process.env.npm_execpath;
    assert.ok(npm, 'Run through npm run test:release or npm test.');
    const env = {
      ...process.env,
      OPENAI_API_KEY: '',
      npm_config_update_notifier: 'false',
    };
    function run(args, expected = 0, cwd = root) {
      const r = spawnSync(process.execPath, args, {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 90000,
        maxBuffer: 4 * 1024 * 1024,
      });
      assert.ifError(r.error);
      assert.equal(r.status, expected, `${r.stdout}\n${r.stderr}`);
      return r;
    }
    const first = join(box, 'artifacts');
    run([npm, 'run', 'release:pack', '--', first]);
    const manifest = JSON.parse(
      fs.readFileSync(join(first, 'release-manifest.json')),
    );
    assert.equal(manifest.version, '0.1.0-alpha.1');
    assert.match(manifest.source_revision, /^[a-f0-9]{40}$/);
    for (const line of fs
      .readFileSync(join(first, 'SHA256SUMS'), 'utf8')
      .trim()
      .split('\n')) {
      const [hash, file] = line.split('  ');
      assert.equal(
        createHash('sha256')
          .update(fs.readFileSync(join(first, file)))
          .digest('hex'),
        hash,
      );
    }
    // A second pack of unchanged source is byte-identical under this Node/npm toolchain.
    const second = join(box, 'second artifacts');
    run([npm, 'run', 'release:pack', '--', second]);
    assert.equal(
      JSON.parse(fs.readFileSync(join(second, 'release-manifest.json')))
        .artifact.sha256,
      manifest.artifact.sha256,
    );
    const original = fs.readFileSync(join(first, 'SHA256SUMS'));
    run([npm, 'run', 'release:pack', '--', first], 1);
    assert.deepEqual(fs.readFileSync(join(first, 'SHA256SUMS')), original);
    const consumer = join(box, 'consumer');
    fs.mkdirSync(consumer);
    fs.writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    );
    run(
      [
        npm,
        'install',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--cache',
        join(box, 'fresh npm cache'),
        join(first, manifest.artifact.filename),
      ],
      0,
      consumer,
    );
    const installed = join(consumer, 'node_modules/shcontext');
    assert.equal(
      run(
        [join(installed, 'dist/cli/index.js'), '--version'],
        0,
        consumer,
      ).stdout.trim(),
      manifest.version,
    );
    const demo = join(box, 'demo repository');
    assert.match(
      run([join(installed, 'examples/offline-demo.mjs'), demo], 0, consumer)
        .stdout,
      /OFFLINE WALKTHROUGH PASSED/,
    );
    const verify = run(
      [join(installed, 'scripts/ci-freshness.mjs'), demo],
      0,
      consumer,
    );
    assert.equal(JSON.parse(verify.stdout).state, 'fresh');
    const before = fs.readFileSync(join(demo, 'src/greet.ts'));
    run([join(installed, 'examples/offline-demo.mjs'), demo], 1, consumer);
    assert.deepEqual(fs.readFileSync(join(demo, 'src/greet.ts')), before);
  },
);
