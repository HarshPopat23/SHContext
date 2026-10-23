import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIProvider } from '../dist/providers/index.js';
import { usageCost } from '../benchmarks/usage-cost.mjs';

const request = {
  instructions: 'Return JSON.',
  input: '{}',
  schema: { type: 'object' },
};
const usage = {
  input_tokens: 100,
  output_tokens: 40,
  total_tokens: 140,
  input_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 },
  output_tokens_details: { reasoning_tokens: 10 },
};
const response = (extra = {}) => ({
  status: 200,
  body: JSON.stringify({
    status: 'completed',
    usage,
    output: [
      { type: 'message', content: [{ type: 'output_text', text: '{}' }] },
    ],
    ...extra,
  }),
});
test('in-flight requests prevent a false complete cost snapshot', async () => {
  let resume;
  const wait = new Promise((resolve) => {
    resume = resolve;
  });
  const p = new OpenAIProvider({
    model: 'm',
    apiKey: 'unused',
    transport: async () => {
      await wait;
      return response();
    },
  });
  const pending = p.generate(request);
  assert.equal(p.getUsage().in_flight_requests, 1);
  assert.equal(
    usageCost(p.getUsage(), { input: 2, cached: 1, write: 3, output: 8 })
      .complete,
    false,
  );
  resume();
  await pending;
  assert.equal(p.getUsage().in_flight_requests, 0);
  assert.equal(p.getUsage().reported_requests, 1);
});
test('provider usage records reported ordinary/cached/write/reasoning tokens without exposing bodies or mutating snapshots', async () => {
  const p = new OpenAIProvider({
    model: 'test-model',
    apiKey: 'unused',
    transport: async () => response(),
  });
  await p.generate(request);
  await p.generate(request);
  const got = p.getUsage();
  assert.equal(got.reported_requests, 2);
  assert.equal(got.input_tokens, 200);
  assert.equal(got.output_tokens, 80);
  assert.equal(got.cached_input_tokens, 40);
  assert.equal(got.cache_write_input_tokens, 60);
  assert.equal(got.reasoning_output_tokens, 20);
  const priced = usageCost(got, { input: 2, cached: 1, write: 3, output: 8 });
  assert.equal(priced.usd, (100 * 2 + 40 + 60 * 3 + 80 * 8) / 1_000_000);
  got.input_tokens = 0;
  assert.equal(p.getUsage().input_tokens, 200);
  assert.ok(!JSON.stringify(p.getUsage()).includes('Return JSON.'));
});
test('incomplete responses retain known usage and failed transport/HTTP/malformed metadata remain unreported', async () => {
  const incomplete = new OpenAIProvider({
    model: 'm',
    apiKey: 'unused',
    transport: async () => response({ status: 'incomplete' }),
  });
  await assert.rejects(incomplete.generate(request));
  assert.equal(incomplete.getUsage().reported_requests, 1);
  for (const transport of [
    async () => {
      throw Error('network');
    },
    async () => ({ status: 429, body: '' }),
    async () => ({ status: 200, body: '{' }),
    async () => response({ usage: { ...usage, input_tokens: -1 } }),
  ]) {
    const p = new OpenAIProvider({ model: 'm', apiKey: 'unused', transport });
    try {
      await p.generate(request);
    } catch {}
    assert.equal(p.getUsage().unreported_requests, 1);
    assert.equal(
      usageCost(p.getUsage(), { input: 2, cached: 1, write: 3, output: 8 }).usd,
      null,
    );
  }
});
test('missing cache/write details are unknown rather than zero-priced usage and pre-dispatch budget rejection records no attempt', async () => {
  const p = new OpenAIProvider({
    model: 'm',
    apiKey: 'unused',
    transport: async () =>
      response({ usage: { input_tokens: 100, output_tokens: 40 } }),
  });
  await p.generate(request);
  assert.equal(p.getUsage().unknown_input_breakdown_requests, 1);
  assert.equal(
    usageCost(p.getUsage(), { input: 2, cached: 1, write: 3, output: 8 })
      .complete,
    false,
  );
  const blocked = new OpenAIProvider({
    model: 'm',
    apiKey: 'unused',
    limits: { maxInputTokens: 1 },
    transport: async () => {
      throw Error('must not send');
    },
  });
  await assert.rejects(blocked.generate(request));
  assert.equal(blocked.getUsage().unreported_requests, 0);
  assert.throws(() =>
    usageCost(p.getUsage(), { input: NaN, cached: 1, write: 3, output: 8 }),
  );
});
