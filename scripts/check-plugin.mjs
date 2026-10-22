import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Integration with the real host CLI, never a stub validator or a model session.
const root = fileURLToPath(new URL('../', import.meta.url));
const argument = process.argv[2] ?? 'claude';
const claude = /[/\\]/.test(argument) ? resolve(argument) : argument;
assert.ok(
  process.argv.length <= 3,
  'Usage: node scripts/check-plugin.mjs [claude-executable]',
);
const box = fs.mkdtempSync(join(tmpdir(), 'shcontext plugin host '));
const env = {
  ...process.env,
  CLAUDE_CONFIG_DIR: join(box, 'host config'),
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  ANTHROPIC_API_KEY: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  OPENAI_API_KEY: '',
};
function run(args, expected = 0) {
  const result = spawnSync(claude, args, {
    cwd: box,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
  return result;
}
try {
  const version = run(['--version']).stdout.trim();
  run(['plugin', 'validate', root, '--strict']);
  // A known-invalid control proves the official validator rejects broken input.
  const bad = join(box, 'invalid plugin');
  fs.mkdirSync(join(bad, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(join(bad, '.claude-plugin/plugin.json'), '{');
  run(['plugin', 'validate', bad, '--strict'], 1);
  run(['plugin', 'marketplace', 'add', root]);
  run([
    'plugin',
    'install',
    'shcontext@shcontext-workflows',
    '--scope',
    'user',
  ]);
  const list = run(['plugin', 'list', '--json']);
  const installed = JSON.parse(list.stdout);
  const item = installed.find(
    (entry) => entry.id === 'shcontext@shcontext-workflows',
  );
  assert.ok(item?.enabled, 'Installed plugin is not enabled.');
  assert.equal(item.version, '0.1.0');
  assert.ok(item.installPath);
  for (const name of ['build', 'update', 'verify', 'query', 'benchmark'])
    assert.ok(
      fs.existsSync(
        join(item.installPath, 'skills', `context-${name}`, 'SKILL.md'),
      ),
    );
  run([
    'plugin',
    'uninstall',
    'shcontext@shcontext-workflows',
    '--scope',
    'user',
  ]);
  assert.ok(
    !JSON.parse(run(['plugin', 'list', '--json']).stdout).some(
      (entry) => entry.id === item.id,
    ),
  );
  console.log(
    `PLUGIN HOST CHECK PASSED (${version}); five skills installed, enabled and removed in isolated config; no model session.`,
  );
} finally {
  fs.rmSync(box, { recursive: true, force: true });
}
