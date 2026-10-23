import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readJSON,
  configure,
  evaluate,
  parseOptions,
  emitReport,
  sha256,
} from './evaluate.mjs';

const options = parseOptions(process.argv.slice(2));
const root = fs.mkdtempSync(join(tmpdir(), 'shcontext real evaluation '));
function git(args, cwd = root) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
try {
  const datasets = readJSON(new URL('./datasets/real.json', import.meta.url));
  const results = [];
  for (const dataset of datasets) {
    const target = join(root, dataset.id);
    git([
      'clone',
      '--quiet',
      '--no-checkout',
      '--no-recurse-submodules',
      dataset.source.url,
      target,
    ]);
    git(
      [
        '-c',
        'core.autocrlf=false',
        'checkout',
        '--quiet',
        '--detach',
        dataset.source.commit,
      ],
      target,
    );
    assert.equal(git(['rev-parse', 'HEAD'], target), dataset.source.commit);
    const tracked = git(['ls-files', '-z'], target).split('\0').filter(Boolean);
    const original = new Map(
      tracked.map((path) => [
        path,
        sha256(fs.readFileSync(join(target, path))),
      ]),
    );
    configure(target);
    const result = await evaluate(target, dataset, options);
    for (const [path, hash] of original)
      assert.equal(
        sha256(fs.readFileSync(join(target, path))),
        hash,
        `Tracked source changed: ${dataset.id}/${path}`,
      );
    result.source.tracked_source_unchanged = true;
    result.source.repositories_executed = false;
    results.push(result);
  }
  await emitReport(
    {
      schema_version: 1,
      mode: 'real pinned source repositories, scripted narrative controls; retrieval usefulness, not live prose quality',
      node: process.version,
      platform: process.platform,
      repositories: results,
    },
    options,
    'REAL REPOSITORY BENCHMARK PASSED',
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
