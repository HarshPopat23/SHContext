import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { fixture as base, put, draftFor } from './generation.mjs';
export { put };
export function fixture(t, { folders = 4, ...options } = {}) {
  const root = fs.realpathSync(base(t, { sources: false, ...options }));
  for (let i = 0; i < folders; i++)
    put(
      root,
      `feature-${i}/index.ts`,
      `export function feature${i}(value: string) { return value.trim(); }\n`,
    );
  return root;
}
export function provider({ latency = 0, transform, reviewTransform } = {}) {
  const calls = [],
    reviews = [];
  let active = 0,
    peak = 0;
  return {
    identity: { id: 'openai', model: 'test-model' },
    calls,
    reviews,
    get peak() {
      return peak;
    },
    get active() {
      return active;
    },
    async generate(request) {
      active++;
      peak = Math.max(peak, active);
      try {
        assert.ok(request.role);
        assert.ok(Number.isSafeInteger(request.max_output_tokens));
        if (latency)
          await new Promise((resolve, reject) => {
            const done = () => {
              request.signal?.removeEventListener('abort', abort);
              resolve();
            };
            const timer = setTimeout(done, latency);
            const abort = () => {
              clearTimeout(timer);
              request.signal?.removeEventListener('abort', abort);
              reject(Error('aborted'));
            };
            request.signal?.addEventListener('abort', abort, { once: true });
            if (request.signal?.aborted) abort();
          });
        const input = JSON.parse(
          request.input.split('\nThe preceding response')[0],
        );
        if (request.role === 'Verifier') {
          reviews.push({ request, input });
          const draft = {
            reviews: input.claims.map((claim) => ({
              claim_id: claim.claim_id,
              verdict: claim.text.includes('spacecraft')
                ? 'contradicted'
                : 'supported',
              evidence_ids: claim.evidence_ids,
              explanation: claim.text.includes('spacecraft')
                ? 'The inspected code has no spacecraft launch operation.'
                : 'The limited claim is consistent with the supplied inspected source.',
            })),
          };
          return reviewTransform
            ? await reviewTransform(draft, input, request)
            : draft;
        }
        calls.push({ request, input });
        const draft = draftFor(input);
        for (const item of draft.files)
          item.claims[0].text = item.path.startsWith('feature-')
            ? 'Exports a function that trims its string input.'
            : item.claims[0].text;
        return transform ? await transform(draft, input, request) : draft;
      } finally {
        active--;
      }
    },
  };
}
