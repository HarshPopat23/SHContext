import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { buildRepository, updateRepository, verifyRepository } from 'shcontext';

assert.equal(
  process.argv.length,
  3,
  'Usage: node examples/offline-demo.mjs <new-demo-directory>',
);
const root = resolve(process.argv[2]);
assert.ok(
  !fs.existsSync(root),
  'Use a new directory; the demo never overwrites an existing project.',
);
fs.mkdirSync(join(root, 'src'), { recursive: true });
fs.writeFileSync(
  join(root, 'shcontext.config.json'),
  JSON.stringify({
    version: 1,
    provider: { id: 'openai', model: 'offline-demo' },
  }),
);
fs.writeFileSync(
  join(root, '.shcontextignore'),
  'shcontext.config.json\n.shcontextignore\n',
);
const file = join(root, 'src/greet.ts');
fs.writeFileSync(
  file,
  "export function greet(name: string) { return 'Hello ' + name; }\n",
);
// This host-injected adapter is deliberately authored, not OpenAI or a model-quality demonstration.
const provider = {
  identity: { id: 'openai', model: 'offline-demo' },
  async generate(request) {
    const input = JSON.parse(request.input);
    const ids = [
      ...new Set([
        ...input.sources.map((x) => x.evidence_id),
        ...input.children.flatMap((x) =>
          x.purpose.flatMap((c) => c.evidence_ids),
        ),
      ]),
    ];
    return {
      purpose: [
        {
          kind: 'inference',
          text: 'Groups the inspected greeting implementation.',
          evidence_ids: ids,
          rationale:
            'Based only on the supplied greeting source and child summary.',
        },
      ],
      files: input.sources.map((source) => ({
        path: source.path,
        claims: [
          {
            kind: 'observed',
            text: 'Exports a greeting function that concatenates its prefix and name.',
            evidence_ids: [source.evidence_id],
            rationale: null,
          },
        ],
      })),
      feature_flows: [],
      tests: [],
      uncertainty: [
        'Offline authored demonstration; no model or repository tests were run.',
      ],
    };
  },
};
const built = await buildRepository(root, { provider });
assert.equal(verifyRepository(root).state, 'fresh');
fs.writeFileSync(
  file,
  "export function greet(name: string) { return 'Hi ' + name; }\n",
);
assert.equal(verifyRepository(root).state, 'stale');
const updated = await updateRepository(root, { provider });
assert.equal(verifyRepository(root).state, 'fresh');
const noop = await updateRepository(root);
assert.equal(noop.model_calls, 0);
console.log(
  JSON.stringify(
    {
      mode: 'offline authored provider; no API calls',
      root,
      build_requests: built.execution.requests,
      changed_folders: updated.regenerated,
      update_requests: updated.model_calls,
      no_op_requests: noop.model_calls,
      final_state: 'fresh',
    },
    null,
    2,
  ),
);
console.log('OFFLINE WALKTHROUGH PASSED');
