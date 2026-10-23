import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  buildRepository,
  analyzeRepository,
  scanRepository,
  queryRepository,
  verifyRepository,
  getProjectInfo,
} from '../dist/index.js';
import { Coordinator } from '../dist/agents/index.js';
import { terms, score, order } from '../dist/query/search.js';

export const sha256 = (value) =>
  'sha256:' + createHash('sha256').update(value).digest('hex');
export const readJSON = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
export const budget = { inputUSDPerMillion: 1, outputUSDPerMillion: 2 };
export function put(root, path, text) {
  fs.mkdirSync(dirname(join(root, path)), { recursive: true });
  fs.writeFileSync(join(root, path), text);
}
export function configure(root) {
  assert.ok(!fs.existsSync(join(root, 'shcontext.config.json')));
  put(
    root,
    'shcontext.config.json',
    JSON.stringify({
      version: 1,
      provider: { id: 'openai', model: 'scripted-control' },
    }),
  );
  put(root, '.shcontextignore', 'shcontext.config.json\n.shcontextignore\n');
}
export function providerFor(dataset, { negative = false } = {}) {
  const stats = { requests: 0, input_bytes: 0, response_bytes: 0 };
  return {
    identity: { id: 'openai', model: 'scripted-control' },
    stats,
    async generate(request) {
      stats.requests++;
      stats.input_bytes += Buffer.byteLength(request.input);
      const input = JSON.parse(request.input);
      const ids = [
        ...new Set([
          ...input.sources.map((x) => x.evidence_id),
          ...input.children.flatMap((x) =>
            x.purpose.flatMap((c) => c.evidence_ids),
          ),
        ]),
      ];
      const draft = {
        purpose: [
          {
            kind: 'inference',
            text: 'Groups the inspected direct files and child evidence.',
            evidence_ids: ids,
            rationale:
              'Based only on the supplied direct sources and child summaries.',
          },
        ],
        files: input.sources.map((source) => ({
          path: source.path,
          claims: [
            {
              kind: 'observed',
              text:
                negative && source.path === dataset.negative_claim?.path
                  ? dataset.negative_claim.text
                  : (dataset.facts.find((f) => f.path === source.path)?.text ??
                    'Inspected file; behavior is not evaluated in this benchmark.'),
              evidence_ids: [source.evidence_id],
              rationale: null,
            },
          ],
        })),
        feature_flows: [],
        tests: [],
        uncertainty: [
          'Scripted control: behavior outside the reviewed file claims is not evaluated.',
        ],
      };
      stats.response_bytes += Buffer.byteLength(JSON.stringify(draft));
      return draft;
    },
  };
}
export function scoreRetrieval(actual, expected) {
  const found = [...new Set(actual)];
  const truth = [...new Set(expected)];
  const hits = truth.filter((path) => found.includes(path)).length;
  return {
    hits,
    expected: truth.length,
    returned: found.length,
    recall: truth.length ? hits / truth.length : null,
    precision: found.length ? hits / found.length : null,
    exact_set: found.length === truth.length && hits === truth.length,
    all_expected: hits === truth.length,
    correct_abstention: truth.length ? null : found.length === 0,
  };
}
export function relationshipLabels(actual, expected = []) {
  return expected.every((wanted) =>
    actual.some(
      (edge) =>
        edge.from === wanted.from &&
        edge.reference.specifier === wanted.specifier &&
        edge.resolution === wanted.resolution &&
        edge.to === wanted.to,
    ),
  );
}
export function reviewClaims(bundle, dataset) {
  const result = {
    supported: 0,
    unsupported: 0,
    unreviewed: 0,
    candidates: 0,
    reviewed: [],
  };
  for (const folder of bundle.folders)
    for (const file of folder.files)
      for (const claim of file.claims) {
        result.candidates++;
        const fact = dataset.facts.find(
          (item) => item.path === file.path && item.text === claim.text,
        );
        const negative = dataset.negative_claim;
        const evidence = claim.evidence_ids.map((id) =>
          folder.evidence.find((item) => item.id === id),
        );
        if (
          fact &&
          evidence.some(
            (item) =>
              item?.path === fact.path &&
              item.sha256 === fact.sha256 &&
              item.start_line <= fact.start_line &&
              item.end_line >= fact.end_line,
          )
        ) {
          result.supported++;
          result.reviewed.push({
            path: fact.path,
            text: claim.text,
            verdict: 'supported',
            source_sha256: fact.sha256,
            start_line: fact.start_line,
            end_line: fact.end_line,
          });
        } else if (
          negative &&
          file.path === negative.path &&
          claim.text === negative.text
        ) {
          result.unsupported++;
          result.reviewed.push({
            path: file.path,
            text: claim.text,
            verdict: 'unsupported',
            reason: negative.reason,
          });
        } else result.unreviewed++;
      }
  return result;
}
export function bindFacts(root, dataset) {
  for (const fact of dataset.facts) {
    const content = fs.readFileSync(join(root, fact.path), 'utf8');
    const hash = sha256(content);
    if (fact.sha256)
      assert.equal(hash, fact.sha256, `Ground truth drift: ${fact.path}`);
    fact.sha256 = hash;
    const lines = content.split(/\r\n|[\n\r\u2028\u2029]/u);
    assert.ok(
      fact.start_line >= 1 &&
        fact.end_line >= fact.start_line &&
        fact.end_line <= lines.length,
    );
    assert.ok(
      lines
        .slice(fact.start_line - 1, fact.end_line)
        .join('\n')
        .includes(fact.basis),
      `Reviewed source basis drift: ${fact.path}`,
    );
  }
  return dataset;
}
export function accounting(provider, execution, elapsed) {
  return {
    elapsed_ms: elapsed,
    requests: provider.stats.requests,
    input_utf8_bytes: provider.stats.input_bytes,
    response_utf8_bytes: provider.stats.response_bytes,
    reserved_input_tokens: execution.reserved_input_tokens,
    reserved_output_tokens: execution.reserved_output_tokens,
    illustrative_reserved_cost_usd: execution.reserved_cost_usd,
    illustrative_rates_usd_per_million: { input: 1, output: 2 },
    actual_model_tokens: null,
    actual_provider_cost_usd: 0,
    basis:
      'Scripted provider: no remote model, actual tokens not applicable; reservations use illustrative caller prices, not market prices or invoices.',
  };
}
function eligible(root) {
  const scan = scanRepository(root);
  return scan.inventory.entries
    .filter((x) => x.kind === 'file' && x.disposition === 'analyzed')
    .map((x) => ({
      path: x.path,
      text: fs.readFileSync(join(root, x.path), 'utf8'),
    }));
}
export function literalExplore(root, question, limit = 8) {
  const wanted = terms(question);
  return eligible(root)
    .map((file) => ({
      path: file.path,
      score: score(`${file.path}\n${file.text}`, wanted),
    }))
    .filter((x) => x.score > 0)
    .sort(order)
    .slice(0, limit)
    .map((x) => x.path);
}
export async function flatSummarize(root, dataset) {
  const p = providerFor(dataset),
    coordinator = new Coordinator(p, { budget });
  const start = performance.now(),
    report = analyzeRepository(root),
    groups = new Map();
  for (const file of report.analyses.filter(
    (x) => x.disposition === 'analyzed' && x.line_count > 0,
  )) {
    const group = dirname(file.path).replaceAll('\\', '/');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({
      path: file.path,
      evidence_id: `E${groups.get(group).length + 1}`,
      content: fs.readFileSync(join(root, file.path), 'utf8'),
    });
  }
  const files = [];
  try {
    for (const [path, sources] of groups) {
      const draft = await coordinator.generate('Folder Analyst', path, {
        instructions:
          'Summarize only these direct folder files; no child summaries or graph.',
        input: JSON.stringify({ source_path: path, sources, children: [] }),
        schema: { type: 'object' },
      });
      for (const file of draft.files)
        files.push({
          path: file.path,
          text: file.claims.map((x) => x.text).join('\n'),
        });
    }
    return {
      files,
      metrics: accounting(p, coordinator.report(), performance.now() - start),
    };
  } finally {
    coordinator.close();
  }
}
export function searchFlat(flat, question, limit = 8) {
  const wanted = terms(question);
  return flat.files
    .map((file) => ({
      path: file.path,
      score: score(`${file.path}\n${file.text}`, wanted),
    }))
    .filter((x) => x.score > 0)
    .sort(order)
    .slice(0, limit)
    .map((x) => x.path);
}
export async function evaluate(root, dataset, { check = false } = {}) {
  bindFacts(root, dataset);
  const p = providerFor(dataset),
    start = performance.now();
  const built = await buildRepository(root, {
    provider: p,
    execution: { budget },
  });
  const generation = accounting(p, built.execution, performance.now() - start);
  assert.equal(verifyRepository(root).state, 'fresh');
  const flat = await flatSummarize(root, dataset);
  const claims = reviewClaims(built.bundle, dataset);
  const questions = [];
  for (const task of dataset.questions) {
    const qstart = performance.now();
    const query = queryRepository(root, task.question, { limit: 8, depth: 2 });
    const shcontext_ms = performance.now() - qstart;
    const estart = performance.now();
    const explored = literalExplore(root, task.question);
    const exploration_ms = performance.now() - estart;
    const fstart = performance.now();
    const flatPaths = searchFlat(flat, task.question);
    const flat_query_ms = performance.now() - fstart;
    const shpaths = query.matches
      .filter((x) => x.inspection !== 'inventory-only')
      .map((x) => x.path);
    const references = query.matches.flatMap((match) => match.references);
    for (const reference of references) {
      const content = fs.readFileSync(join(root, reference.path), 'utf8');
      assert.equal(reference.sha256, sha256(content));
      assert.ok(
        reference.start_line >= 1 &&
          reference.end_line >= reference.start_line &&
          reference.end_line <=
            content.split(/\r\n|[\n\r\u2028\u2029]/u).length,
      );
    }
    const labels = relationshipLabels(query.relationships, task.relationships);
    const scored = {
      ...task,
      shcontext: {
        paths: shpaths,
        score: scoreRetrieval(shpaths, task.expected),
        elapsed_ms: shcontext_ms,
        status: query.status,
        relationship_labels_correct: labels,
        references,
        relationships: query.relationships.map((edge) => ({
          from: edge.from,
          to: edge.to,
          reference: { specifier: edge.reference.specifier },
          resolution: edge.resolution,
        })),
      },
      literal_exploration: {
        paths: explored,
        score: scoreRetrieval(explored, task.expected),
        elapsed_ms: exploration_ms,
      },
      flat_folder: {
        paths: flatPaths,
        score: scoreRetrieval(flatPaths, task.expected),
        elapsed_ms: flat_query_ms,
      },
    };
    if (check)
      assert.ok(
        scored.shcontext.score.all_expected,
        `Missing expected implementation files: ${dataset.id}/${task.id}`,
      );
    if (check && !task.expected.length)
      assert.ok(
        scored.shcontext.score.correct_abstention,
        `False positive: ${task.id}`,
      );
    if (check) assert.ok(labels, `Incorrect relationship labels: ${task.id}`);
    questions.push(scored);
  }
  if (check) {
    assert.equal(claims.unsupported, 0);
    assert.equal(claims.supported, dataset.facts.length);
  }
  return {
    id: dataset.id,
    scope: dataset.scope,
    tool_version: getProjectInfo().version,
    generation_identity: built.bundle.manifest.generation,
    dataset_sha256: sha256(JSON.stringify(dataset)),
    source: dataset.source ?? null,
    coverage: built.bundle.inventory.coverage,
    eligible_folders: built.bundle.folders.length,
    inventory: built.bundle.inventory.entries.reduce((out, x) => {
      out[x.disposition] = (out[x.disposition] ?? 0) + 1;
      return out;
    }, {}),
    generation,
    flat_generation: flat.metrics,
    claims,
    questions,
  };
}
export function parseOptions(argv) {
  const options = { check: false, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') options.check = true;
    else if (
      argv[i] === '--output' &&
      argv[i + 1] &&
      !argv[i + 1].startsWith('--') &&
      options.output === null
    )
      options.output = argv[++i];
    else throw Error('Usage: [--check] [--output file.json]');
  }
  return options;
}
export async function emitReport(report, options, marker) {
  const json = JSON.stringify(report, null, 2) + '\n';
  if (options.output) {
    const { format } = await import('prettier');
    fs.mkdirSync(dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, await format(json, { parser: 'json' }));
  }
  console.log(json);
  if (options.check) console.log(marker);
}
