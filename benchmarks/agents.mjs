import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir, cpus, platform } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { buildRepository, verifyRepository } from '../dist/index.js';
import { provider } from '../tests/helpers/agents.mjs';
const check = process.argv.slice(2).includes('--check');
const writeReport = process.argv.slice(2).includes('--write-report');
if (
  process.argv
    .slice(2)
    .some((arg) => !['--check', '--write-report'].includes(arg))
)
  throw Error('Usage: npm run benchmark:agents -- [--check] [--write-report]');
const root = fs.mkdtempSync(join(tmpdir(), 'shcontext agent benchmark '));
const folderCount = 8,
  latency = 120,
  trials = 3;
function tree(path) {
  const files = {};
  for (const name of fs
    .readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const target = join(path, name.name);
    if (name.isDirectory())
      for (const [key, value] of Object.entries(tree(target)))
        files[`${name.name}/${key}`] = value;
    else
      files[name.name] = createHash('sha256')
        .update(fs.readFileSync(target))
        .digest('hex');
  }
  return files;
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  fs.writeFileSync(
    join(root, 'shcontext.config.json'),
    JSON.stringify({
      version: 1,
      provider: { id: 'openai', model: 'test-model' },
    }),
  );
  for (let i = 0; i < folderCount; i++) {
    fs.mkdirSync(join(root, `feature-${i}`));
    fs.writeFileSync(
      join(root, `feature-${i}/index.ts`),
      `export function feature${i}(value: string) { return value.trim(); }\n`,
    );
  }
  const samples = [];
  let expected;
  async function run(workers, warmup = false) {
    const p = provider({ latency }),
      start = performance.now();
    const result = await buildRepository(root, {
        provider: p,
        review: true,
        execution: { workers },
      }),
      ms = performance.now() - start;
    const bytes = tree(join(root, 'context'));
    if (expected) assert.deepEqual(bytes, expected);
    else expected = bytes;
    assert.equal(verifyRepository(root).state, 'fresh');
    assert.equal(result.bundle.folders.length, folderCount + 1);
    assert.equal(p.calls.length, result.bundle.folders.length);
    assert.equal(p.reviews.length, result.bundle.folders.length);
    assert.equal(result.execution.requests, p.calls.length + p.reviews.length);
    assert.ok(
      result.execution.reviews.every(
        (item) => item.status === 'no-issues-found',
      ),
    );
    assert.equal(p.peak, workers);
    if (!warmup)
      samples.push({
        workers,
        ms,
        requests: result.execution.requests,
        peak: p.peak,
        folders: result.bundle.folders.length,
        evidence: result.bundle.folders.reduce(
          (count, folder) => count + folder.evidence.length,
          0,
        ),
        coverage: result.bundle.inventory.coverage,
        output_files: Object.keys(bytes).length,
      });
  }
  await run(1, true);
  await run(4, true);
  for (let i = 0; i < trials; i++)
    for (const workers of i % 2 ? [4, 1] : [1, 4]) await run(workers);
  const sequential = median(
      samples.filter((item) => item.workers === 1).map((item) => item.ms),
    ),
    parallel = median(
      samples.filter((item) => item.workers === 4).map((item) => item.ms),
    ),
    speedup = sequential / parallel;
  const result = {
    mode: 'controlled provider, no network or live model; semantic responses are authored, not an independent quality evaluation',
    node: process.version,
    platform: platform(),
    cpu: cpus()[0]?.model,
    folder_count: folderCount,
    provider_latency_ms: latency,
    review: true,
    trials_per_mode: trials,
    sequential_median_ms: sequential,
    parallel_median_ms: parallel,
    speedup,
    saved_ms: sequential - parallel,
    exact_output_equality: true,
    samples,
  };
  console.log(JSON.stringify(result, null, 2));
  if (check) {
    assert.ok(
      speedup > 1.1,
      `Measured speedup ${speedup} did not exceed the declared 1.1 acceptance threshold`,
    );
  }
  if (writeReport) await saveReport(result);
  if (check) console.log('AGENT BENCHMARK PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

async function saveReport(result) {
  const { format } = await import('prettier');
  const a = result.samples.find((sample) => sample.workers === 1),
    b = result.samples.find((sample) => sample.workers === 4);
  const text = `# Controlled agent execution benchmark

This measures async folder scheduling with an authored provider, not live-model
performance, independent semantic accuracy or real billing. Reproduce and refresh
these reports from a checkout with:

\`\`\`sh
npm ci
npm run benchmark:agents -- --check --write-report
\`\`\`

${result.folder_count} independent source folders plus root were generated with
source-based model review enabled in both modes. Every provider response waits
${result.provider_latency_ms} ms. After one warm-up per mode,
${result.trials_per_mode} timed runs per mode alternate execution order. Measured
time includes source discovery/analysis, generation, serial review, validation and
owned publication; verification and byte-comparison assertions run outside it.

| Measured property | Sequential | Four folder workers |
| --- | ---: | ---: |
| Median elapsed time | ${result.sequential_median_ms.toFixed(2)} ms | ${result.parallel_median_ms.toFixed(2)} ms |
| Peak in-flight requests | ${a.peak} | ${b.peak} |
| Requests, including model review | ${a.requests} | ${b.requests} |
| Folder summaries | ${a.folders} | ${b.folders} |
| Citation records across summaries | ${a.evidence} | ${b.evidence} |
| Owned files, including manifest/report/cache | ${a.output_files} | ${b.output_files} |
| Coverage | ${a.coverage} | ${b.coverage} |
| Owned output hashes | Identical | Identical |

Measured speedup: **${result.speedup.toFixed(2)}×**, saving approximately
**${result.saved_ms.toFixed(0)} ms** per controlled run. The threshold check
independently computes median speedup and requires more than 1.1×; it does not
print a success marker unless coverage, output/evidence equality, request counts,
concurrency and the measured speedup pass assertions.

Environment: Node ${result.node}, ${result.platform}; reported CPU model
${result.cpu} (the label does not establish available CPU quota). Full precision
measurements and each trial are in [agent-results.json](agent-results.json).

The Coordinator overlaps Folder Analyst requests while keeping parent/root order
and a single writer. The Architecture Analyst/root and Verifier remain serial,
which limits speedup. Request count is unchanged; this is not a spending reduction.
The fixture has independent folders, so its latency benefit does not predict
speedup for a one-folder or deeply nested repository.

All source hashes, line ranges, bundle/ownership schemas and output bytes are
checked by the same pipeline in both modes. Controlled review responses agree,
but that agreement is not proof that a model explains code accurately. Separate
negative controls demonstrate both detection of a contradictory claim and failure
of a deliberately always-supporting reviewer. No network call, live-model quality
evaluation, actual-token accounting or real-price comparison occurred.
`;
  fs.writeFileSync(
    new URL('./agent-results.json', import.meta.url),
    await format(JSON.stringify(result), { parser: 'json' }),
  );
  fs.writeFileSync(
    new URL('./agent-results.md', import.meta.url),
    await format(text, { parser: 'markdown' }),
  );
}
