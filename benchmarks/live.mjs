import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import {
  resolve,
  relative,
  sep,
  isAbsolute,
  dirname,
  basename,
  join,
} from 'node:path';
import { buildRepository, scanRepository } from '../dist/index.js';
import { OpenAIProvider } from '../dist/providers/index.js';
import { usageCost } from './usage-cost.mjs';

let provider, report, destination, prices;
const start = performance.now();
try {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      output: { type: 'string' },
      'input-price': { type: 'string' },
      'cached-price': { type: 'string' },
      'write-price': { type: 'string' },
      'output-price': { type: 'string' },
      'max-cost': { type: 'string' },
      workers: { type: 'string' },
    },
  });
  const number = (value) =>
    value !== undefined && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  prices = {
    input: number(values['input-price']),
    cached: number(values['cached-price']),
    write: number(values['write-price']),
    output: number(values['output-price']),
  };
  if (
    !values.root ||
    !values.output ||
    !Object.values(prices).every(
      (x) => Number.isFinite(x) && x >= 0 && x <= 1_000_000,
    )
  )
    throw Error('arguments');
  const maxCost = number(values['max-cost']),
    workers = values.workers === undefined ? 1 : number(values.workers);
  if (
    !Number.isFinite(maxCost) ||
    maxCost < 0 ||
    maxCost > 1000 ||
    !Number.isInteger(workers) ||
    workers < 1 ||
    workers > 8
  )
    throw Error('limits');
  const selected = resolve(values.root);
  if (fs.lstatSync(selected).isSymbolicLink()) throw Error('selected_root');
  const root = fs.realpathSync(selected);
  const requestedReport = resolve(values.output);
  destination = join(
    fs.realpathSync(dirname(requestedReport)),
    basename(requestedReport),
  );
  const where = relative(root, destination);
  if (
    !(where === '..' || where.startsWith('..' + sep) || isAbsolute(where)) ||
    fs.existsSync(destination)
  )
    throw Error('report_destination');
  const scan = scanRepository(root),
    identity = scan.configuration.provider;
  if (identity?.id !== 'openai' || !process.env.OPENAI_API_KEY)
    throw Error('provider_prerequisites');
  provider = new OpenAIProvider({
    model: identity.model,
    apiKey: process.env.OPENAI_API_KEY,
  });
  const built = await buildRepository(root, {
    provider,
    execution: {
      workers,
      budget: {
        maxRequests: 8,
        maxCostUSD: maxCost,
        inputUSDPerMillion: Math.max(prices.input, prices.cached, prices.write),
        outputUSDPerMillion: prices.output,
      },
    },
  });
  report = {
    mode: 'live OpenAI generation; source is transmitted and context is published',
    status: 'completed',
    model: identity.model,
    elapsed_ms: performance.now() - start,
    coverage: built.bundle.inventory.coverage,
    execution: built.execution,
    usage: provider.getUsage(),
    caller_prices_usd_per_million: prices,
    usage_priced_cost: usageCost(provider.getUsage(), prices),
    semantic_review: 'not independently evaluated by this runner',
  };
} catch (error) {
  report = {
    mode: 'live OpenAI generation',
    status: provider ? 'failed' : 'blocked',
    elapsed_ms: performance.now() - start,
    code:
      typeof error?.code === 'string'
        ? error.code
        : 'live_prerequisite_or_argument_failure',
    usage: provider?.getUsage() ?? null,
    execution: error?.execution
      ? {
          requests: error.execution.requests,
          retries: error.execution.retries,
          reserved_input_tokens: error.execution.reserved_input_tokens,
          reserved_output_tokens: error.execution.reserved_output_tokens,
          reserved_cost_usd: error.execution.reserved_cost_usd,
        }
      : null,
    caller_prices_usd_per_million: provider ? prices : null,
    usage_priced_cost: provider ? usageCost(provider.getUsage(), prices) : null,
    message:
      'Check explicit root/output, all four caller prices, max-cost, configured OpenAI model and host key. Failed or unreported requests may still be billed; no source/response body was logged.',
  };
  process.exitCode = 1;
}
const text = JSON.stringify(report, null, 2) + '\n';
// Exclusive creation never overwrites a report; only a validated outside-root destination is used.
if (destination && provider)
  try {
    fs.writeFileSync(destination, text, { flag: 'wx' });
  } catch {
    console.error(
      'Live metrics report could not be written; existing files were not overwritten.',
    );
    process.exitCode = 1;
  }
console.log(text);
