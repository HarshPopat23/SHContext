import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { handleMessage, callTool, TOOLS } from '../dist/mcp/index.js';
import { built, fixture, put } from './helpers/query.mjs';
import { snapshot } from './helpers/verification.mjs';

const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const call = (root, name, args) => {
  const out = callTool(root, name, args);
  return { ...out, data: out.isError ? null : JSON.parse(out.content[0].text) };
};

test('initialize negotiates a version and advertises tools only', () => {
  const r = handleMessage('/nowhere', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' },
  });
  assert.equal(r.result.protocolVersion, '2025-03-26');
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(r.result.serverInfo.name, 'shcontext');
  assert.equal(
    handleMessage('/nowhere', {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
    null,
  );
  assert.equal(
    handleMessage('/nowhere', { jsonrpc: '2.0', id: 2, method: 'nope' }).error
      .code,
    -32601,
  );
  assert.equal(handleMessage('/nowhere', 'junk').error.code, -32600);
  const list = handleMessage('/nowhere', {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
  });
  assert.deepEqual(
    list.result.tools.map((x) => x.name),
    TOOLS.map((x) => x.name),
  );
});

test('ctx_status, ctx_verify and ctx_query answer from a built context', async (t) => {
  const root = await built(t);
  const before = snapshot(root);
  assert.equal(call(root, 'ctx_status', {}).data.state, 'current');
  assert.equal(call(root, 'ctx_verify', {}).data.state, 'fresh');
  const q = call(root, 'ctx_query', { question: 'verifySession', limit: 3 });
  assert.equal(q.data.status, 'answered');
  assert.deepEqual(snapshot(root), before, 'tools never write');
});

test('ctx_folder reports per-folder trust and rejects unknown folders', async (t) => {
  const root = await built(t);
  const fresh = call(root, 'ctx_folder', { path: 'src/auth' });
  assert.equal(fresh.data.freshness, 'fresh');
  assert.match(fresh.data.document, /Context: src/);
  put(root, 'src/auth/session.ts', 'export const changed = 1;\n');
  const stale = call(root, 'ctx_folder', { path: 'src/auth' });
  assert.equal(stale.data.freshness, 'stale');
  assert.deepEqual(stale.data.changed_files, ['src/auth/session.ts']);
  assert.equal(
    call(root, 'ctx_folder', { path: 'src/billing' }).data.freshness,
    'fresh',
  );
  for (const path of ['../etc', '/etc', 'src/missing', 'context'])
    assert.equal(callTool(root, 'ctx_folder', { path }).isError, true, path);
});

test('ctx_cite returns lines, detects drift and cannot read unselected files', async (t) => {
  const root = await built(t);
  const q = call(root, 'ctx_query', { question: 'verifySession' });
  const ref = q.data.matches.find((m) => m.references[0]).references[0];
  const hit = call(root, 'ctx_cite', {
    path: ref.path,
    start_line: ref.start_line,
    end_line: ref.end_line,
    sha256: ref.sha256,
  });
  assert.equal(hit.data.unchanged_since_citation, true);
  assert.match(hit.data.excerpt, new RegExp(`^${ref.start_line}: `));
  put(
    root,
    ref.path,
    '// edited\n' +
      (await import('node:fs')).readFileSync(`${root}/${ref.path}`, 'utf8'),
  );
  const moved = call(root, 'ctx_cite', {
    path: ref.path,
    start_line: 1,
    end_line: 2,
    sha256: ref.sha256,
  });
  assert.equal(moved.data.unchanged_since_citation, false);
  for (const path of [
    '../outside.ts',
    '/etc/passwd',
    'context/CONTEXT.md',
    'nope.ts',
  ])
    assert.equal(
      callTool(root, 'ctx_cite', { path, start_line: 1, end_line: 5 }).isError,
      true,
      path,
    );
  assert.equal(
    callTool(root, 'ctx_cite', { path: ref.path, start_line: 5, end_line: 2 })
      .isError,
    true,
  );
});

test('bad arguments and unknown tools are tool errors, not crashes', async (t) => {
  const root = fixture(t);
  for (const [name, args] of [
    ['ctx_query', {}],
    ['ctx_query', { question: 5 }],
    ['ctx_query', { question: 'x', extra: 1 }],
    ['ctx_status', { surprise: true }],
    ['ctx_nope', {}],
  ])
    assert.equal(callTool(root, name, args).isError, true, name);
});

test('stdio server speaks newline-delimited JSON-RPC end to end', async (t) => {
  const root = await built(t);
  const child = spawn(process.execPath, [cli, 'mcp', '--root', root], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const lines = [];
  let buffer = '';
  child.stdout.on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      lines.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'ctx_status', arguments: {} },
  });
  child.stdin.write('not json\n');
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  assert.equal(lines.length, 3, JSON.stringify(lines));
  assert.equal(lines[0].id, 1);
  assert.equal(JSON.parse(lines[1].result.content[0].text).state, 'current');
  assert.equal(lines[2].error.code, -32700);
});
