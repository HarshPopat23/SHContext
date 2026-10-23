import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { configure, put } from '../benchmarks/evaluate.mjs';
import { snapshot } from './helpers/verification.mjs';

test('opt-in live runner blocks missing prerequisites, preserves files and refuses spending before transport', (t) => {
  const box = fs.mkdtempSync(join(tmpdir(), 'shcontext live guards '));
  t.after(() => fs.rmSync(box, { recursive: true, force: true }));
  const root = join(box, 'repo');
  fs.mkdirSync(root);
  configure(root);
  put(root, 'src/file.ts', 'export const value=1;\n');
  const runner = fileURLToPath(
    new URL('../benchmarks/live.mjs', import.meta.url),
  );
  const report = join(box, 'report.json');
  const flags = [
    '--root',
    root,
    '--output',
    report,
    '--input-price',
    '2',
    '--cached-price',
    '1',
    '--write-price',
    '3',
    '--output-price',
    '8',
    '--max-cost',
    '0',
  ];
  const before = snapshot(root);
  const invoke = (args, key = '') => {
    const r = spawnSync(
      process.execPath,
      [
        '--import',
        'data:text/javascript,globalThis.fetch=()=>{throw Error("NETWORK BLOCKED")}',
        runner,
        ...args,
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, OPENAI_API_KEY: key },
      },
    );
    assert.ifError(r.error);
    assert.equal(r.status, 1, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.equal(invoke(flags).status, 'blocked');
  assert.equal(fs.existsSync(report), false);
  const failure = invoke(flags, 'unused-test-key');
  assert.equal(failure.code, 'agent_budget');
  assert.equal(failure.usage.reported_requests, 0);
  assert.equal(failure.usage.unreported_requests, 0);
  assert.equal(failure.usage_priced_cost.usd, 0);
  assert.deepEqual(fs.readdirSync(join(root, '.shcontext')), []);
  const after = snapshot(root);
  delete after['.shcontext/'];
  assert.deepEqual(after, before);
  const existing = fs.readFileSync(report);
  assert.equal(invoke(flags, 'unused-test-key').status, 'blocked');
  assert.deepEqual(fs.readFileSync(report), existing);
  const inside = [...flags];
  inside[3] = join(root, 'must-not-write.json');
  assert.equal(invoke(inside, 'unused-test-key').status, 'blocked');
  assert.equal(fs.existsSync(inside[3]), false);
});
