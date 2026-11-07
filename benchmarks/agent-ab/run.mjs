// Agent A/B runner. See README.md. Writes one JSON line per (task, arm, trial).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { parseAgentOutput, totalTokens, grade } from './lib.mjs';

const AGENTS_MD_BLOCK = fs.readFileSync(
  new URL('./arm-pointer.md', import.meta.url),
  'utf8',
);

/** Prepare one fresh working copy for an arm. Returns the directory. */
export function prepareArm({ arm, source, contextSource, handwritten }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shctx-ab-'));
  fs.cpSync(source, dir, {
    recursive: true,
    filter: (p) =>
      !p.split(path.sep).includes('.git') &&
      !p.split(path.sep).includes('node_modules'),
  });
  const copyContext = () =>
    fs.cpSync(contextSource, path.join(dir, 'context'), { recursive: true });
  if (arm === 'none') return dir;
  if (arm === 'handwritten') {
    fs.writeFileSync(
      path.join(dir, 'AGENTS.md'),
      fs.readFileSync(handwritten, 'utf8'),
    );
    return dir;
  }
  if (arm === 'shcontext-pointer' || arm === 'shcontext-mcp') {
    copyContext();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), AGENTS_MD_BLOCK);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), AGENTS_MD_BLOCK);
    if (arm === 'shcontext-mcp')
      fs.writeFileSync(
        path.join(dir, '.mcp.json'),
        JSON.stringify(
          {
            mcpServers: { shcontext: { command: 'shcontext', args: ['mcp'] } },
          },
          null,
          2,
        ),
      );
    return dir;
  }
  throw new Error(`Unknown arm "${arm}".`);
}

export function runOne({ agent, prompt, dir, timeoutMs }) {
  const started = Date.now();
  const r = spawnSync(agent[0], [...agent.slice(1), prompt], {
    cwd: dir,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = parseAgentOutput(r.stdout ?? '');
  return {
    ...parsed,
    duration_ms: parsed.duration_ms ?? Date.now() - started,
    timed_out: r.error?.code === 'ETIMEDOUT',
    exit_code: r.status,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      tasks: { type: 'string' },
      output: { type: 'string' },
      trials: { type: 'string', default: '3' },
      'dry-run': { type: 'boolean' },
    },
  });
  if (!values.tasks || !values.output) {
    console.error(
      'Usage: run.mjs --tasks tasks.json --output results.jsonl [--trials 3] [--dry-run]',
    );
    process.exit(1);
  }
  const spec = JSON.parse(fs.readFileSync(values.tasks, 'utf8'));
  const trials = Number(values.trials);
  const plan = [];
  for (const task of spec.tasks)
    for (const arm of spec.arms)
      for (let trial = 1; trial <= trials; trial++)
        plan.push({ task, arm, trial });
  if (values['dry-run']) {
    console.log(
      JSON.stringify(
        {
          runs: plan.length,
          arms: spec.arms,
          tasks: spec.tasks.length,
          trials,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  if (fs.existsSync(values.output)) {
    console.error('Refusing to overwrite an existing results file.');
    process.exit(1);
  }
  for (const { task, arm, trial } of plan) {
    const dir = prepareArm({
      arm,
      source: spec.repo,
      contextSource: spec.context,
      handwritten: spec.handwritten,
    });
    try {
      if (spec.setup) {
        const s = spawnSync(spec.setup.command, spec.setup.args ?? [], {
          cwd: dir,
          encoding: 'utf8',
          timeout: spec.setup.timeout_ms ?? 600000,
        });
        if (s.status !== 0)
          throw new Error(`setup failed for ${task.id}/${arm}`);
      }
      const run = runOne({
        agent: spec.agent,
        prompt: task.prompt,
        dir,
        timeoutMs: spec.timeout_ms ?? 600000,
      });
      const success =
        !run.is_error && !run.timed_out && grade(task.check, run.answer, dir);
      fs.appendFileSync(
        values.output,
        JSON.stringify({
          task: task.id,
          type: task.type,
          arm,
          trial,
          success,
          tokens: totalTokens(run),
          cost_usd: run.cost_usd,
          duration_ms: run.duration_ms,
          turns: run.turns,
          timed_out: run.timed_out,
          exit_code: run.exit_code,
        }) + '\n',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
