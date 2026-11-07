import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { built, fixture, put } from './helpers/query.mjs';

const hook = fileURLToPath(
  new URL('../docs/examples/hooks/session-status.mjs', import.meta.url),
);
const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const run = (cwd, env = {}) =>
  spawnSync(process.execPath, [hook], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHCONTEXT_BIN: process.execPath,
      SHCONTEXT_BIN_ARGS: JSON.stringify([cli]),
      ...env,
    },
  });

test('session hook reports current, stale and missing context without failing', async (t) => {
  const root = await built(t);
  const ok = run(root);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /all \d+ folder summaries match/);
  put(root, 'src/auth/session.ts', 'export const x = 1;\n');
  assert.match(
    run(root).stdout,
    /stale\. Read source directly in: .*src\/auth/,
  );
  const none = run(fixture(t));
  assert.equal(none.status, 0);
  assert.match(none.stdout, /context is missing/);
  const absent = run(root, {
    SHCONTEXT_BIN: '/nonexistent/shcontext',
    SHCONTEXT_BIN_ARGS: '[]',
  });
  assert.equal(absent.status, 0);
  assert.equal(absent.stdout, '');
});
