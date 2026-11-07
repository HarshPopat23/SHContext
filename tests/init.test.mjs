import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { initRepository, BLOCK_START, BLOCK_END } from '../dist/init/index.js';
import { buildRepository, verifyRepository } from '../dist/index.js';
import { fixture, fakeProvider, put } from './helpers/verification.mjs';

const cli = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const read = (root, path) => fs.readFileSync(join(root, path), 'utf8');

test('init creates AGENTS.md with one block and ignores it from analysis', (t) => {
  const root = fixture(t);
  const changes = initRepository(root);
  assert.deepEqual(
    changes.map((c) => [c.path, c.action]),
    [
      ['.shcontextignore', 'created'],
      ['AGENTS.md', 'created'],
    ],
  );
  const text = read(root, 'AGENTS.md');
  assert.equal(text.split(BLOCK_START).length, 2);
  assert.match(text, /shcontext status/);
  assert.match(read(root, '.shcontextignore'), /^AGENTS\.md$/m);
});

test('init is idempotent and preserves surrounding user text', (t) => {
  const root = fixture(t);
  put(root, 'AGENTS.md', '# Mine\n\nKeep this.\n');
  initRepository(root);
  const once = read(root, 'AGENTS.md');
  assert.match(once, /^# Mine\n\nKeep this\./);
  assert.ok(once.includes(BLOCK_START) && once.includes(BLOCK_END));
  assert.ok(initRepository(root).every((c) => c.action === 'unchanged'));
  assert.equal(read(root, 'AGENTS.md'), once);
  put(root, 'AGENTS.md', once.replace('Keep this.', 'Edited text.'));
  initRepository(root);
  assert.match(read(root, 'AGENTS.md'), /Edited text\./);
});

test('init refuses a half-present marker and symlinked targets', (t) => {
  const root = fixture(t);
  put(root, 'AGENTS.md', `x\n${BLOCK_START}\nunfinished\n`);
  assert.throws(() => initRepository(root), { code: 'broken_markers' });
  const other = fixture(t);
  put(other, 'real.md', 'real\n');
  fs.symlinkSync(join(other, 'real.md'), join(other, 'AGENTS.md'));
  assert.throws(() => initRepository(other), { code: 'unsafe_target' });
  assert.equal(read(other, 'real.md'), 'real\n');
});

test('init --claude --mcp writes CLAUDE.md and merges .mcp.json without clobbering', (t) => {
  const root = fixture(t);
  put(
    root,
    '.mcp.json',
    JSON.stringify({ mcpServers: { other: { command: 'x' } } }),
  );
  initRepository(root, { targets: ['agents', 'claude'], mcp: true });
  assert.ok(fs.existsSync(join(root, 'CLAUDE.md')));
  const config = JSON.parse(read(root, '.mcp.json'));
  assert.deepEqual(config.mcpServers.other, { command: 'x' });
  assert.deepEqual(config.mcpServers.shcontext, {
    command: 'shcontext',
    args: ['mcp'],
  });
  const custom = fixture(t);
  put(
    custom,
    '.mcp.json',
    JSON.stringify({ mcpServers: { shcontext: { command: 'mine' } } }),
  );
  const result = initRepository(custom, { mcp: true });
  assert.equal(result.find((c) => c.path === '.mcp.json').action, 'skipped');
  assert.equal(
    JSON.parse(read(custom, '.mcp.json')).mcpServers.shcontext.command,
    'mine',
  );
  const bad = fixture(t);
  put(bad, '.mcp.json', '{not json');
  assert.throws(() => initRepository(bad, { mcp: true }), {
    code: 'invalid_mcp_config',
  });
  assert.equal(read(bad, '.mcp.json'), '{not json');
});

test('running init before build keeps context fresh; init CLI works', async (t) => {
  const root = fixture(t);
  const r = spawnSync(process.execPath, [cli, 'init', root, '--mcp'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  await buildRepository(root, { provider: fakeProvider() });
  assert.equal(verifyRepository(root).state, 'fresh');
  // Editing the instruction files later must not stale the context.
  put(root, 'AGENTS.md', read(root, 'AGENTS.md') + '\nMore notes.\n');
  assert.equal(verifyRepository(root).state, 'fresh');
});

test('init options are rejected for other commands', () => {
  const r = spawnSync(process.execPath, [cli, 'scan', '.', '--claude'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
});
