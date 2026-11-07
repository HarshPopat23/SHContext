import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  parseAgentOutput,
  totalTokens,
  grade,
  mulberry32,
  bootstrapMean,
  analyze,
} from '../benchmarks/agent-ab/lib.mjs';
import { prepareArm, runOne } from '../benchmarks/agent-ab/run.mjs';

const fake = fileURLToPath(
  new URL('./fixtures/agent-ab/fake-agent.mjs', import.meta.url),
);
const tmp = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

test('parseAgentOutput reads claude-style JSON and tolerates plain text', () => {
  const r = parseAgentOutput(
    JSON.stringify({
      result: 'hi',
      total_cost_usd: 0.2,
      duration_ms: 5,
      num_turns: 3,
      usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 6 },
    }),
  );
  assert.equal(r.answer, 'hi');
  assert.equal(totalTokens(r), 20);
  assert.equal(r.cost_usd, 0.2);
  const plain = parseAgentOutput('just text');
  assert.equal(plain.answer, 'just text');
  assert.equal(plain.cost_usd, null);
  assert.equal(totalTokens(plain), null);
});

test('grade supports contains/regex/command and rejects unknown checks', (t) => {
  assert.equal(
    grade({ kind: 'contains_all', values: ['A.ts', 'b.ts'] }, 'a.ts and B.ts'),
    true,
  );
  assert.equal(
    grade({ kind: 'contains_all', values: ['a.ts', 'c.ts'] }, 'a.ts'),
    false,
  );
  assert.equal(grade({ kind: 'contains_any', values: ['x', 'a'] }, 'a'), true);
  assert.equal(grade({ kind: 'regex', pattern: '^ok\\b' }, 'OK now'), true);
  assert.equal(
    grade(
      {
        kind: 'command',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
      },
      '',
      tmp(t),
    ),
    true,
  );
  assert.equal(
    grade(
      {
        kind: 'command',
        command: process.execPath,
        args: ['-e', 'process.exit(3)'],
      },
      '',
      tmp(t),
    ),
    false,
  );
  assert.equal(grade({ kind: 'nope' }, 'x'), false);
  assert.equal(grade(null, 'x'), false);
});

test('bootstrap is deterministic and brackets an obvious effect', () => {
  assert.equal(mulberry32(7)(), mulberry32(7)());
  const diffs = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1];
  const a = bootstrapMean(diffs, { seed: 3 });
  assert.deepEqual(a, bootstrapMean(diffs, { seed: 3 }));
  assert.ok(a.low > 0 && a.low <= a.mean && a.mean <= a.high);
  assert.equal(bootstrapMean([]).mean, null);
});

test('arms isolate what the agent can see and the runner records usage', async (t) => {
  const src = tmp(t);
  fs.writeFileSync(path.join(src, 'a.ts'), 'export {}');
  const ctx = tmp(t);
  fs.writeFileSync(path.join(ctx, 'CONTEXT.md'), '# Context: .\n');
  const hand = path.join(tmp(t), 'AGENTS.md');
  fs.writeFileSync(hand, 'handwritten');
  const dirs = [];
  for (const arm of [
    'none',
    'handwritten',
    'shcontext-pointer',
    'shcontext-mcp',
  ]) {
    const dir = prepareArm({
      arm,
      source: src,
      contextSource: ctx,
      handwritten: hand,
    });
    dirs.push(dir);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  const seen = (i) =>
    ['context/CONTEXT.md', 'AGENTS.md', '.mcp.json'].map((f) =>
      fs.existsSync(path.join(dirs[i], f)),
    );
  assert.deepEqual(seen(0), [false, false, false]);
  assert.deepEqual(seen(1), [false, true, false]);
  assert.deepEqual(seen(2), [true, true, false]);
  assert.deepEqual(seen(3), [true, true, true]);
  assert.ok(fs.existsSync(path.join(dirs[0], 'a.ts')));
  assert.throws(() =>
    prepareArm({ arm: 'bogus', source: src, contextSource: ctx }),
  );
  const run = runOne({
    agent: [process.execPath, fake],
    prompt: 'q?',
    dir: dirs[2],
    timeoutMs: 20000,
  });
  assert.match(run.answer, /context=true/);
  assert.equal(totalTokens(run), 150);
  assert.equal(run.cost_usd, 0.05);
});

test('analyze pairs runs, applies overhead and applies pre-registered verdicts', () => {
  const rec = [];
  for (let task = 1; task <= 12; task++)
    for (let trial = 1; trial <= 3; trial++) {
      rec.push({
        task: `t${task}`,
        arm: 'none',
        trial,
        success: task % 3 === 0,
        tokens: 1000,
        cost_usd: 0.1,
        duration_ms: 100,
      });
      rec.push({
        task: `t${task}`,
        arm: 'ctx',
        trial,
        success: task % 3 !== 1,
        tokens: 600,
        cost_usd: 0.06,
        duration_ms: 80,
      });
      rec.push({
        task: `t${task}`,
        arm: 'same',
        trial,
        success: task % 3 === 0,
        tokens: 990,
        cost_usd: 0.1,
        duration_ms: 100,
      });
    }
  const out = analyze(rec, { baseline: 'none', overhead: { ctx: 0.01 } });
  assert.equal(out.arms.none.paired_vs_baseline, null);
  assert.equal(out.arms.ctx.paired_vs_baseline.pairs, 36);
  assert.ok(out.arms.ctx.paired_vs_baseline.success_delta.low > 0);
  assert.ok(Math.abs(out.arms.ctx.mean_cost_usd - 0.07) < 1e-9);
  assert.equal(out.verdicts.ctx, 'pass: success gain');
  assert.equal(out.verdicts.same, 'fail: no pre-registered win');
  assert.throws(() => analyze(rec, { baseline: 'missing' }));
});
