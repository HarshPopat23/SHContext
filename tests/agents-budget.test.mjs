import assert from 'node:assert/strict';
import test from 'node:test';
import { Coordinator } from '../dist/agents/index.js';
import {
  RetryableProviderError,
  OpenAIProvider,
} from '../dist/providers/index.js';
const request = {
  instructions: 'Return bounded JSON.',
  input: '{}',
  schema: { type: 'object', properties: {}, additionalProperties: false },
};
function adapter(transform) {
  const calls = [];
  return {
    identity: { id: 'openai', model: 'm' },
    calls,
    async generate(req) {
      calls.push(req);
      return transform ? transform(req) : {};
    },
  };
}
for (const options of [
  { workers: 0 },
  { workers: 9 },
  { workers: 1.5 },
  { maxRetries: 3 },
  { timeoutMs: 0 },
  { budget: { maxRequests: 0 } },
  { budget: { maxInputTokens: Infinity } },
  { budget: { maxCostUSD: 1 } },
  { budget: { inputUSDPerMillion: 1 } },
  {
    budget: { maxCostUSD: NaN, inputUSDPerMillion: 1, outputUSDPerMillion: 1 },
  },
  { budget: { outputTokensPerRequest: 32769 } },
  { invented: true },
])
  test(`invalid coordinator settings are rejected: ${JSON.stringify(options)}`, () => {
    const p = adapter();
    assert.throws(
      () => new Coordinator(p, options),
      (error) => error.code === 'agent_configuration',
    );
    assert.equal(p.calls.length, 0);
  });
test('concurrent request reservations cannot exceed a shared request ceiling', async () => {
  const p = adapter(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {};
    }),
    c = new Coordinator(p, { workers: 4, budget: { maxRequests: 2 } });
  try {
    await assert.rejects(
      c.map([1, 2, 3, 4, 5], (id) =>
        c.generate('Folder Analyst', String(id), request),
      ),
      (error) => error.code === 'agent_budget',
    );
    assert.equal(p.calls.length, 2);
    assert.equal(c.report().requests, 2);
  } finally {
    c.close();
  }
});
for (const budget of [
  { maxInputTokens: 1 },
  { maxOutputTokens: 1 },
  { maxCostUSD: 0, inputUSDPerMillion: 1, outputUSDPerMillion: 2 },
])
  test(`a reservation exceeding ${JSON.stringify(budget)} dispatches no request`, async () => {
    const p = adapter(),
      c = new Coordinator(p, { budget });
    try {
      await assert.rejects(
        c.generate('Folder Analyst', 'a', request),
        (error) => error.code === 'agent_budget',
      );
      assert.equal(p.calls.length, 0);
      assert.equal(c.report().requests, 0);
    } finally {
      c.close();
    }
  });
test('caller-priced cost and token reservations include failed requests and retries without refunds', async () => {
  let attempts = 0;
  const p = adapter(() => {
      if (attempts++ === 0) throw new RetryableProviderError();
      return {};
    }),
    c = new Coordinator(p, {
      maxRetries: 1,
      retryDelayMs: 0,
      budget: {
        maxRequests: 3,
        inputUSDPerMillion: 2,
        outputUSDPerMillion: 8,
        maxCostUSD: 1,
        outputTokensPerRequest: 100,
      },
    });
  try {
    await c.generate('Folder Analyst', 'a', request);
    const stats = c.report();
    assert.equal(stats.requests, 2);
    assert.equal(stats.retries, 1);
    assert.equal(stats.reserved_output_tokens, 200);
    assert.equal(
      stats.reserved_cost_usd,
      (stats.reserved_input_tokens * 2 + stats.reserved_output_tokens * 8) /
        1_000_000,
    );
    assert.ok(stats.reserved_cost_usd <= 1);
    assert.ok(p.calls.every((call) => call.max_output_tokens === 100));
  } finally {
    c.close();
  }
});
test('retry cannot bypass a budget already spent by its first failed request', async () => {
  const p = adapter(() => {
      throw new RetryableProviderError();
    }),
    c = new Coordinator(p, {
      maxRetries: 2,
      retryDelayMs: 0,
      budget: { maxRequests: 1 },
    });
  try {
    await assert.rejects(
      c.generate('Folder Analyst', 'a', request),
      (error) => error.code === 'agent_budget',
    );
    assert.equal(p.calls.length, 1);
    assert.equal(c.report().requests, 1);
  } finally {
    c.close();
  }
});
test('input estimate counts schema and instructions, not only source body bytes', async () => {
  const p = adapter(),
    c = new Coordinator(p, { budget: { maxInputTokens: 3000 } });
  try {
    await assert.rejects(
      c.generate('Folder Analyst', 'a', {
        ...request,
        instructions: 'x'.repeat(3000),
      }),
      (error) => error.code === 'agent_budget',
    );
    assert.equal(p.calls.length, 0);
  } finally {
    c.close();
  }
});
test('permanent, timeout and cancelled requests are not retried as transient failures', async () => {
  for (const mode of ['permanent', 'timeout', 'cancel']) {
    const controller = new AbortController(),
      p = adapter(() => {
        if (mode === 'permanent') throw Error('permanent');
        if (mode === 'cancel') controller.abort();
        return new Promise(() => {});
      });
    const c = new Coordinator(p, {
      maxRetries: 2,
      timeoutMs: 10,
      signal: controller.signal,
    });
    try {
      await assert.rejects(c.generate('Folder Analyst', 'a', request));
      assert.equal(p.calls.length, 1);
      assert.equal(c.report().retries, 0);
    } finally {
      c.close();
    }
  }
});
test('OpenAI honors a coordinator output ceiling and classifies settled transient HTTP errors', async () => {
  const sent = [];
  const p = new OpenAIProvider({
    model: 'm',
    apiKey: 'unused',
    transport: async (req) => {
      sent.push(JSON.parse(req.body));
      return sent.length === 1
        ? { status: 429, body: 'discarded' }
        : {
            status: 200,
            body: JSON.stringify({
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: '{}' }],
                },
              ],
            }),
          };
    },
  });
  const c = new Coordinator(p, {
    maxRetries: 1,
    retryDelayMs: 0,
    budget: { outputTokensPerRequest: 23 },
  });
  try {
    await c.generate('Verifier', 'a', request);
    assert.equal(sent.length, 2);
    assert.ok(
      sent.every(
        (body) =>
          body.max_output_tokens === 23 &&
          body.text.format.name === 'source_review',
      ),
    );
    assert.equal(c.report().reserved_output_tokens, 46);
  } finally {
    c.close();
  }
});

test('a failed build exposes reservations already spent without exposing rejected source or response bodies', async (t) => {
  const { fixture, provider } = await import('./helpers/agents.mjs');
  const { buildRepository } = await import('../dist/index.js');
  const root = fixture(t),
    p = provider();
  await assert.rejects(
    buildRepository(root, {
      provider: p,
      execution: { budget: { maxRequests: 1 } },
    }),
    (error) => {
      assert.equal(error.code, 'agent_budget');
      assert.equal(error.execution.requests, 1);
      assert.ok(error.execution.reserved_input_tokens > 0);
      assert.ok(error.execution.reserved_output_tokens > 0);
      assert.ok(
        !JSON.stringify(error.execution).includes('return value.trim()'),
      );
      return true;
    },
  );
});

test('direct dispatch cannot bypass the worker ceiling outside the pool', async () => {
  let resume;
  const pending = new Promise((resolve) => {
    resume = resolve;
  });
  const p = adapter(async () => {
      await pending;
      return {};
    }),
    c = new Coordinator(p, { workers: 1 });
  const first = c.generate('Folder Analyst', 'a', request);
  try {
    await assert.rejects(
      c.generate('Folder Analyst', 'b', request),
      (error) => error.code === 'agent_concurrency',
    );
    assert.equal(p.calls.length, 1);
  } finally {
    resume();
  }
  await first;
  assert.equal(c.report().peak_requests, 1);
  c.close();
});

test('validated policies are immutable and cannot be changed through the public options snapshot', () => {
  const c = new Coordinator(adapter(), {
    workers: 2,
    budget: { maxRequests: 1 },
  });
  try {
    assert.throws(() => {
      c.options.workers = 8;
    }, TypeError);
    assert.throws(() => {
      c.options.budget.maxRequests = 100;
    }, TypeError);
    assert.equal(c.options.budget.maxRequests, 1);
  } finally {
    c.close();
  }
});
