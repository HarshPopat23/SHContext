import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  hostFixture,
  readRequest,
  envelope,
  snapshot,
  put,
} from './helpers/host.mjs';
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const noNetwork =
  'data:text/javascript,globalThis.fetch=()=>{throw Error("NETWORK BLOCKED")}';
function run(args, expected = 0) {
  const result = spawnSync(
    process.execPath,
    ['--import', noNetwork, cli, ...args],
    {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' },
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return result;
}
function finish(root, session, update = false) {
  let r = JSON.parse(
    run([
      'prepare',
      root,
      '--session',
      session,
      ...(update ? ['--update'] : []),
    ]).stdout,
  );
  while (r.status === 'awaiting_draft') {
    const draft = join(session, 'response.json');
    fs.writeFileSync(draft, JSON.stringify(envelope(readRequest(session))));
    r = JSON.parse(
      run(['submit', root, '--session', session, '--draft', draft]).stdout,
    );
  }
  return JSON.parse(run(['finalize', root, '--session', session]).stdout);
}
test('CLI completes host build/change/update/query/verify without keys or network and resumes preparation', (t) => {
  const { root, session, box } = hostFixture(t),
    before = snapshot(root);
  const args = ['prepare', root, '--session', session];
  const first = JSON.parse(run(args).stdout),
    request = fs.readFileSync(first.request_file);
  assert.equal(first.status, 'awaiting_draft');
  assert.equal(JSON.parse(run(args).stdout).session_id, first.session_id);
  assert.deepEqual(fs.readFileSync(first.request_file), request);
  assert.deepEqual(snapshot(root), before);
  const built = finish(root, session);
  assert.equal(built.coverage, 'complete');
  assert.equal(JSON.parse(run(['verify', root]).stdout).state, 'fresh');
  assert.ok(
    JSON.parse(
      run(['query', 'verifySession', '--root', root, '--json']).stdout,
    ).matches.some((x) => x.path === 'auth/session.ts'),
  );
  put(
    root,
    'auth/session.ts',
    'export function verifySession(token: string) { return token === "signed:ok"; }\n',
  );
  assert.equal(JSON.parse(run(['verify', root], 1).stdout).state, 'stale');
  assert.equal(finish(root, join(box, 'update'), true).changed, true);
  assert.equal(JSON.parse(run(['verify', root]).stdout).state, 'fresh');
  const noop = finish(root, join(box, 'noop'), true);
  assert.equal(noop.changed, false);
  assert.equal(noop.host_drafts, 0);
});
for (const args of [
  ['prepare'],
  ['prepare', '.', '--session', 's', '--draft', 'd'],
  ['submit', '.', '--session', 's'],
  ['finalize', '.', '--session', 's', '--update'],
  ['prepare', '.', '--session', 's', '--workers', '2'],
  ['scan', '.', '--session', 's'],
  ['prepare', '.', '--session', 's', '--root', '.'],
])
  test(`host CLI rejects invalid arguments ${args}`, () => {
    run(args, 1);
  });
test('host help is side-effect free and host build never falls back to an API adapter', (t) => {
  for (const command of ['prepare', 'submit', 'finalize'])
    assert.match(run([command, '--help']).stdout, /Host options/);
  const { root, session } = hostFixture(t),
    before = snapshot(root);
  assert.match(run(['build', root], 1).stderr, /host_workflow_required/);
  assert.deepEqual(snapshot(root), before);
  fs.writeFileSync(
    join(root, 'shcontext.config.json'),
    JSON.stringify({ version: 1, provider: { id: 'openai', model: 'test' } }),
  );
  assert.match(
    run(['prepare', root, '--session', session], 1).stderr,
    /host_configuration/,
  );
});
