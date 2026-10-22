import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenAIProvider,
  DEFAULT_PROVIDER_LIMITS,
} from '../dist/providers/index.js';
const request = {
  instructions: 'Summarize supplied data as JSON.',
  input: 'source',
  schema: {
    type: 'object',
    properties: { purpose: { type: 'string' } },
    required: ['purpose'],
    additionalProperties: false,
  },
};
const completed = (text = '{"purpose":"summary"}') => ({
  status: 200,
  body: JSON.stringify({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  }),
});
function provider(transport, limits = {}) {
  return new OpenAIProvider({
    model: 'test-model',
    apiKey: 'test-key',
    transport,
    limits,
  });
}

test('fixed Responses endpoint, strict schema, model, store:false and output ceiling are sent through adapter', async () => {
  let sent;
  const p = provider(async (req) => {
    sent = req;
    return completed();
  });
  assert.deepEqual(await p.generate(request), { purpose: 'summary' });
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(sent.body);
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema, request.schema);
  assert.equal(body.model, 'test-model');
  assert.equal(body.max_output_tokens, DEFAULT_PROVIDER_LIMITS.maxOutputTokens);
  assert.equal(Object.hasOwn(body, 'tools'), false);
});
for (const value of [0, -1, NaN, Infinity, 1.2])
  test(`invalid finite limits fail before transport: ${value}`, () => {
    assert.throws(
      () =>
        provider(
          () => {
            throw Error('must not call');
          },
          { maxInputTokens: value },
        ),
      (e) => e.code === 'provider_configuration',
    );
  });
test('credentials, unknown limits, oversized timeout and inconsistent ceilings fail', () => {
  for (const options of [
    { model: 'm', apiKey: '' },
    { model: 'm', apiKey: 'bad\nheader' },
    { model: 'm', apiKey: 'k', limits: { timeoutMs: 300001 } },
    { model: 'm', apiKey: 'k', limits: { maxRunInputTokens: 1 } },
    { model: 'm', apiKey: 'k', limits: { unknown: 1 } },
  ])
    assert.throws(
      () => new OpenAIProvider(options),
      (e) => e.code === 'provider_configuration',
    );
});
test('request bytes are conservatively bounded without silent truncation', async () => {
  let count = 0;
  const p = provider(
    async () => {
      count++;
      return completed();
    },
    { maxInputTokens: 1100 },
  );
  await assert.rejects(
    p.generate({ ...request, input: '漢'.repeat(1000) }),
    (e) => e.code === 'request_budget',
  );
  assert.equal(count, 0);
});
test('input and output run ceilings reserve each attempt before transport', async () => {
  for (const limits of [
    { maxInputTokens: 2000, maxRunInputTokens: 2000 },
    { maxRunOutputTokens: 4096 },
  ]) {
    let calls = 0;
    const p = provider(async () => {
      calls++;
      return completed();
    }, limits);
    await p.generate(request);
    await assert.rejects(p.generate(request), (e) => e.code === 'run_budget');
    assert.equal(calls, 1);
  }
});
test('timeouts settle even if an injected transport ignores cancellation', async () => {
  let signal;
  const p = provider(
    (req) => {
      signal = req.signal;
      return new Promise(() => {});
    },
    { timeoutMs: 20 },
  );
  await assert.rejects(
    p.generate(request),
    (e) => e.code === 'provider_timeout',
  );
  assert.equal(signal.aborted, true);
});
test('caller cancellation aborts a live request and pre-aborted requests send nothing', async () => {
  const controller = new AbortController();
  let calls = 0;
  const p = provider(() => {
    calls++;
    controller.abort();
    return new Promise(() => {});
  });
  await assert.rejects(
    p.generate({ ...request, signal: controller.signal }),
    (e) => e.code === 'cancelled',
  );
  await assert.rejects(
    p.generate({ ...request, signal: controller.signal }),
    (e) => e.code === 'cancelled',
  );
  assert.equal(calls, 1);
});
for (const [name, response, code] of [
  [
    'HTTP failure',
    { status: 429, body: 'SOURCE AND SECRET ECHO' },
    'provider_http',
  ],
  [
    'incomplete response',
    { status: 200, body: '{"status":"incomplete","output":[]}' },
    'provider_incomplete',
  ],
  [
    'refusal',
    {
      status: 200,
      body: JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'SOURCE AND SECRET ECHO' }],
          },
        ],
      }),
    },
    'provider_refusal',
  ],
  [
    'malformed JSON',
    { status: 200, body: 'SOURCE AND SECRET ECHO' },
    'provider_response',
  ],
  ['non-JSON output', completed('SOURCE AND SECRET ECHO'), 'provider_response'],
  [
    'oversized response',
    { status: 200, body: 'X'.repeat(1048577) },
    'provider_response',
  ],
  [
    'missing content',
    { status: 200, body: '{"status":"completed","output":[]}' },
    'provider_response',
  ],
])
  test(`${name} fails safely without response body or retries`, async () => {
    let calls = 0;
    const p = provider(async () => {
      calls++;
      return response;
    });
    await assert.rejects(p.generate(request), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes('SOURCE AND SECRET ECHO'), false);
      return true;
    });
    assert.equal(calls, 1);
  });
test('transport errors never expose request credentials or arbitrary exception text', async () => {
  const p = provider(async () => {
    throw Error('test-key SOURCE_PAYLOAD');
  });
  await assert.rejects(p.generate(request), (error) => {
    assert.equal(error.code, 'provider_response');
    assert.equal(error.message.includes('test-key'), false);
    return true;
  });
});

test('native fetch transport uses redirect rejection and bounded successful response decoding', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let options;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    options = init;
    return new Response(completed().body, { status: 200 });
  };
  const p = new OpenAIProvider({ model: 'test-model', apiKey: 'test-unused' });
  assert.deepEqual(await p.generate(request), { purpose: 'summary' });
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
});

test('native transport rejects oversized/invalid UTF-8 bodies and discards HTTP error bytes', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const body of [new Uint8Array(1048577), new Uint8Array([255])]) {
    globalThis.fetch = async () => new Response(body, { status: 200 });
    await assert.rejects(
      new OpenAIProvider({
        model: 'test-model',
        apiKey: 'test-unused',
      }).generate(request),
      (e) => e.code === 'provider_response',
    );
  }
  let cancelled = false;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    body: {
      cancel: async () => {
        cancelled = true;
      },
    },
  });
  await assert.rejects(
    new OpenAIProvider({ model: 'test-model', apiKey: 'test-unused' }).generate(
      request,
    ),
    (e) => e.code === 'provider_http',
  );
  assert.equal(cancelled, true);
});

test('response capacity is reserved within the declared context window before calls', () => {
  assert.throws(
    () => provider(async () => completed(), { contextWindowTokens: 32000 }),
    (e) => e.code === 'provider_configuration',
  );
});
