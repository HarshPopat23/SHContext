import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolve, join, dirname } from 'node:path';
import {
  prepareRepository,
  submitRepository,
  finalizeRepository,
  verifyRepository,
} from 'shcontext';

// Authored protocol walkthrough, not a simulated claim of live Claude execution.
assert.equal(
  process.argv.length,
  3,
  'Usage: node examples/host-demo.mjs <new-demo-directory>',
);
const root = resolve(process.argv[2]),
  sessions = root + '-host-sessions';
assert.ok(
  !fs.existsSync(root) && !fs.existsSync(sessions),
  'Demo and sibling session directories must both be new.',
);
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(sessions);
const put = (path, value) => {
  fs.mkdirSync(dirname(join(root, path)), { recursive: true });
  fs.writeFileSync(join(root, path), value);
};
put(
  'shcontext.config.json',
  JSON.stringify({
    version: 1,
    provider: { id: 'host', model: 'claude-code-session' },
  }),
);
put('.shcontextignore', 'shcontext.config.json\n.shcontextignore\n');
put(
  'src/greet.ts',
  'export function greet(name: string) { return "Hello " + name; }\n',
);
async function generate(name, update = false) {
  const session = join(sessions, name);
  let state = await prepareRepository(root, session, { update });
  while (state.status === 'awaiting_draft') {
    const r = JSON.parse(fs.readFileSync(state.request_file, 'utf8'));
    const ids = r.input.evidence.map((e) => e.id);
    const draft = {
      purpose: [
        {
          kind: 'inference',
          text: 'Provides the inspected greeting helper.',
          evidence_ids: ids,
          rationale:
            'The direct source or child summary establishes the greeting responsibility.',
        },
      ],
      files: r.input.sources.map((s) => ({
        path: s.path,
        claims: [
          {
            kind: 'observed',
            text: s.content.includes('"Hi "')
              ? 'Returns Hi followed by the supplied name.'
              : 'Returns Hello followed by the supplied name.',
            evidence_ids: [s.evidence_id],
            rationale: null,
          },
        ],
      })),
      feature_flows: [],
      tests: [],
      uncertainty: ['No tests were inspected or executed.'],
    };
    state = await submitRepository(root, session, {
      session_id: r.session_id,
      request_id: r.request_id,
      draft,
    });
  }
  return finalizeRepository(root, session);
}
const built = await generate('build');
assert.ok(built.host_drafts > 0);
assert.equal(verifyRepository(root).state, 'fresh');
put(
  'src/greet.ts',
  'export function greet(name: string) { return "Hi " + name; }\n',
);
assert.equal(verifyRepository(root).state, 'stale');
const updated = await generate('update', true);
assert.equal(updated.changed, true);
assert.equal(verifyRepository(root).state, 'fresh');
const unchanged = await generate('unchanged', true);
assert.equal(unchanged.changed, false);
assert.equal(unchanged.host_drafts, 0);
console.log(
  JSON.stringify(
    {
      root,
      sessions,
      built_drafts: built.host_drafts,
      updated_drafts: updated.host_drafts,
      unchanged_drafts: unchanged.host_drafts,
      final_state: verifyRepository(root).state,
      actual_host_tokens: null,
      actual_host_cost_usd: null,
    },
    null,
    2,
  ),
);
console.log('HOST WALKTHROUGH PASSED (authored drafts; no model/API calls)');
