import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildRepository,
  updateRepository,
  verifyRepository,
  validateContract,
} from '../dist/index.js';
import { RetryableProviderError } from '../dist/providers/index.js';
import { fixture, provider, put } from './helpers/agents.mjs';
import { snapshot } from './helpers/verification.mjs';

test('bounded pool overlaps independent folders, preserves exact controlled bytes and waits for children before root', async (t) => {
  const root = fixture(t, { folders: 6 }),
    sequential = provider({ latency: 15 });
  const first = await buildRepository(root, {
    provider: sequential,
    review: true,
  });
  const before = snapshot(join(root, 'context')),
    parallel = provider({ latency: 15 });
  const second = await buildRepository(root, {
    provider: parallel,
    review: true,
    execution: { workers: 3 },
  });
  assert.equal(sequential.peak, 1);
  assert.equal(parallel.peak, 3);
  assert.equal(second.execution.peak_requests, 3);
  assert.deepEqual(snapshot(join(root, 'context')), before);
  assert.deepEqual(first.bundle, second.bundle);
  assert.equal(validateContract('bundle', second.bundle).success, true);
  assert.equal(parallel.calls.at(-1).input.source_path, '.');
  assert.equal(parallel.calls.at(-1).input.children.length, 6);
  assert.deepEqual(first.execution.reviews, second.execution.reviews);
  assert.equal(verifyRepository(root).state, 'fresh');
});
test('nested folder waves do not synthesize a parent until all its own children finish', async (t) => {
  const root = fixture(t, { folders: 0 });
  put(root, 'a/x/file.ts', 'export const x=1;');
  put(root, 'a/y/file.ts', 'export const y=1;');
  put(root, 'b/z/file.ts', 'export const z=1;');
  const p = provider({ latency: 5 }),
    result = await buildRepository(root, {
      provider: p,
      execution: { workers: 4 },
    });
  for (const call of p.calls)
    for (const child of call.input.children) {
      const index = p.calls.findIndex(
        (item) => item.input.source_path === child.source_path,
      );
      assert.ok(index >= 0 && index < p.calls.indexOf(call));
    }
  assert.equal(result.bundle.folders.length, 6);
  assert.equal(verifyRepository(root).state, 'fresh');
});
test('only explicitly transient settled failures retry within the requested bound', async (t) => {
  const root = fixture(t, { folders: 3 }),
    base = provider();
  let failures = 0;
  const p = {
    identity: base.identity,
    async generate(request) {
      if (
        request.input.includes('feature-0/index.ts') &&
        request.role === 'Folder Analyst' &&
        failures++ === 0
      )
        throw new RetryableProviderError();
      return base.generate(request);
    },
  };
  const result = await buildRepository(root, {
    provider: p,
    execution: { workers: 3, maxRetries: 1, retryDelayMs: 0 },
  });
  assert.equal(result.execution.retries, 1);
  assert.equal(result.execution.requests, base.calls.length + 1);
  assert.equal(verifyRepository(root).state, 'fresh');
});
for (const mode of [
  'permanent',
  'retry-exhausted',
  'cancel',
  'timeout',
  'invalid-draft',
])
  test(`${mode} stops the pool, settles workers and preserves prior owned output`, async (t) => {
    const root = fixture(t, { folders: 5 });
    await buildRepository(root, { provider: provider() });
    const before = snapshot(join(root, 'context')),
      controller = new AbortController();
    let attempts = 0;
    const base = provider({ latency: 20 });
    const p = {
      identity: base.identity,
      async generate(request) {
        attempts++;
        if (request.input.includes('feature-0/index.ts')) {
          if (mode === 'permanent') throw Error('permanent');
          if (mode === 'retry-exhausted') throw new RetryableProviderError();
          if (mode === 'cancel') controller.abort();
          if (mode === 'timeout') return new Promise(() => {});
          if (mode === 'invalid-draft') return {};
        }
        return base.generate(request);
      },
    };
    await assert.rejects(
      buildRepository(root, {
        provider: p,
        signal: controller.signal,
        execution: {
          workers: 3,
          maxRetries: 1,
          retryDelayMs: 0,
          timeoutMs: mode === 'timeout' ? 30 : 1000,
        },
      }),
    );
    assert.deepEqual(snapshot(join(root, 'context')), before);
    assert.deepEqual(fs.readdirSync(join(root, '.shcontext')), []);
    assert.equal(base.active, 0);
    assert.ok(attempts < 10);
  });
test('cancellation while waiting for a retry does not dispatch another paid request', async (t) => {
  const root = fixture(t, { folders: 1 }),
    controller = new AbortController();
  let calls = 0;
  const p = {
    identity: { id: 'openai', model: 'test-model' },
    async generate() {
      calls++;
      setTimeout(() => controller.abort(), 10);
      throw new RetryableProviderError();
    },
  };
  await assert.rejects(
    buildRepository(root, {
      provider: p,
      signal: controller.signal,
      execution: { maxRetries: 2, retryDelayMs: 200 },
    }),
    (error) => error.code === 'cancelled',
  );
  assert.equal(calls, 1);
});
test('parallel incremental update reuses independent folders and leaves a no-op untouched', async (t) => {
  const root = fixture(t, { folders: 6 });
  await buildRepository(root, {
    provider: provider(),
    execution: { workers: 3 },
  });
  put(root, 'feature-2/index.ts', 'export const changed=1;');
  const p = provider(),
    result = await updateRepository(root, {
      provider: p,
      execution: { workers: 4 },
    });
  assert.deepEqual(result.regenerated, ['.', 'feature-2']);
  assert.equal(result.reused.length, 5);
  const before = snapshot(join(root, 'context')),
    noop = await updateRepository(root, { execution: { workers: 4 } });
  assert.equal(noop.model_calls, 0);
  assert.deepEqual(snapshot(join(root, 'context')), before);
});
test('folder workers never write source or output; the coordinator publishes once and rejects competing writers', async (t) => {
  const root = fixture(t, { folders: 4 });
  await buildRepository(root, { provider: provider() });
  const before = snapshot(join(root, 'context'));
  let entered, resume;
  const start = new Promise((resolve) => {
      entered = resolve;
    }),
    pause = new Promise((resolve) => {
      resume = resolve;
    });
  const p = provider({
    transform: async (draft, input) => {
      if (input.source_path === 'feature-0') {
        entered();
        await pause;
      }
      return draft;
    },
  });
  const run = buildRepository(root, { provider: p, execution: { workers: 3 } });
  await start;
  try {
    assert.deepEqual(snapshot(join(root, 'context')), before);
    await assert.rejects(
      buildRepository(root, { provider: provider() }),
      (error) => error.code === 'build_locked',
    );
  } finally {
    resume();
  }
  await run;
  assert.equal(verifyRepository(root).state, 'fresh');
});
