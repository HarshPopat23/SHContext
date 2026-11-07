// Pure helpers for the agent A/B harness: result parsing, grading and statistics.
import { spawnSync } from 'node:child_process';

/** Tolerant parser for `claude -p --output-format json`; missing fields become null. */
export function parseAgentOutput(stdout) {
  let data = null;
  try {
    data = JSON.parse(stdout);
  } catch {
    // Fall through: treat stdout as the plain-text answer.
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (!data || typeof data !== 'object')
    return {
      answer: String(stdout ?? ''),
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      cost_usd: null,
      duration_ms: null,
      turns: null,
      is_error: false,
    };
  const u = data.usage ?? {};
  return {
    answer: typeof data.result === 'string' ? data.result : '',
    input_tokens: num(u.input_tokens),
    output_tokens: num(u.output_tokens),
    cache_read_tokens: num(u.cache_read_input_tokens),
    cache_write_tokens: num(u.cache_creation_input_tokens),
    cost_usd: num(data.total_cost_usd),
    duration_ms: num(data.duration_ms),
    turns: num(data.num_turns),
    is_error: data.is_error === true,
  };
}

export const totalTokens = (r) =>
  r.input_tokens === null && r.output_tokens === null
    ? null
    : (r.input_tokens ?? 0) +
      (r.output_tokens ?? 0) +
      (r.cache_read_tokens ?? 0) +
      (r.cache_write_tokens ?? 0);

/**
 * Grade one answer. Checks come from the (trusted) task file.
 *   contains_all: every string must appear (case-insensitive)
 *   contains_any: at least one string must appear
 *   regex: pattern must match
 *   command: run in the working copy; exit 0 passes (executes repository code)
 */
export function grade(check, answer, cwd) {
  if (!check || typeof check !== 'object') return false;
  const hay = String(answer).toLowerCase();
  switch (check.kind) {
    case 'contains_all':
      return check.values.every((v) => hay.includes(String(v).toLowerCase()));
    case 'contains_any':
      return check.values.some((v) => hay.includes(String(v).toLowerCase()));
    case 'regex':
      return new RegExp(check.pattern, check.flags ?? 'i').test(answer);
    case 'command': {
      const r = spawnSync(check.command, check.args ?? [], {
        cwd,
        timeout: check.timeout_ms ?? 120000,
        encoding: 'utf8',
      });
      return r.status === 0;
    }
    default:
      return false;
  }
}

/** Deterministic PRNG so reported intervals reproduce exactly. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Percentile bootstrap CI of the mean of paired differences. */
export function bootstrapMean(
  diffs,
  { iterations = 5000, seed = 1, alpha = 0.05 } = {},
) {
  if (!diffs.length) return { mean: null, low: null, high: null, n: 0 };
  const rand = mulberry32(seed);
  const means = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < diffs.length; j++)
      sum += diffs[Math.floor(rand() * diffs.length)];
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  const at = (p) =>
    means[
      Math.min(means.length - 1, Math.max(0, Math.floor(p * means.length)))
    ];
  return {
    mean: mean(diffs),
    low: at(alpha / 2),
    high: at(1 - alpha / 2),
    n: diffs.length,
  };
}

/**
 * Aggregate JSONL records [{task, arm, trial, success, tokens, cost_usd, duration_ms, ...}].
 * Differences are paired per (task, trial) against `baseline`, so only runs
 * present in both arms count. Generation (build) cost is amortised by the caller
 * through `overhead_usd_per_task` and added to the arm's cost.
 */
export function analyze(
  records,
  { baseline, thresholds = {}, seed = 1, overhead = {} } = {},
) {
  const arms = [...new Set(records.map((r) => r.arm))].sort();
  if (!arms.includes(baseline))
    throw new Error(`No records for baseline arm "${baseline}".`);
  const key = (r) => `${r.task}\u0000${r.trial}`;
  const byArm = new Map(
    arms.map((a) => [
      a,
      new Map(records.filter((r) => r.arm === a).map((r) => [key(r), r])),
    ]),
  );
  const out = {};
  for (const arm of arms) {
    const rows = [...byArm.get(arm).values()];
    const pairs = [...byArm.get(arm)]
      .filter(([k]) => byArm.get(baseline).has(k))
      .map(([k, r]) => [r, byArm.get(baseline).get(k)]);
    const adj = (r) =>
      r.cost_usd === null ? null : r.cost_usd + (overhead[r.arm] ?? 0);
    const metric = (f) => {
      const d = pairs
        .map(([a, b]) => [f(a), f(b)])
        .filter(([x, y]) => x !== null && y !== null)
        .map(([x, y]) => x - y);
      return bootstrapMean(d, { seed });
    };
    out[arm] = {
      runs: rows.length,
      success_rate: mean(rows.map((r) => (r.success ? 1 : 0))),
      mean_tokens: mean(rows.map((r) => r.tokens).filter((x) => x !== null)),
      mean_cost_usd: mean(rows.map(adj).filter((x) => x !== null)),
      mean_duration_ms: mean(
        rows.map((r) => r.duration_ms).filter((x) => x !== null),
      ),
      paired_vs_baseline:
        arm === baseline
          ? null
          : {
              pairs: pairs.length,
              success_delta: metric((r) => (r.success ? 1 : 0)),
              token_delta: metric((r) => r.tokens),
              cost_delta_usd: metric(adj),
              duration_delta_ms: metric((r) => r.duration_ms),
            },
    };
  }
  const verdicts = {};
  for (const arm of arms) {
    const p = out[arm].paired_vs_baseline;
    if (!p) continue;
    const minGain = thresholds.min_success_gain ?? 0.1;
    const maxTokenRatio = thresholds.max_token_ratio ?? 0.75;
    const base = out[baseline].mean_tokens;
    const successWin =
      p.success_delta.low !== null &&
      p.success_delta.low > 0 &&
      p.success_delta.mean >= minGain;
    const noWorse = p.success_delta.low !== null && p.success_delta.low > -0.05;
    const cheaper =
      base !== null &&
      out[arm].mean_tokens !== null &&
      out[arm].mean_tokens <= base * maxTokenRatio;
    verdicts[arm] = successWin
      ? 'pass: success gain'
      : noWorse && cheaper
        ? 'pass: same success, fewer tokens'
        : 'fail: no pre-registered win';
  }
  return { baseline, arms: out, verdicts };
}
