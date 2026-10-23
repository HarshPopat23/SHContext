import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test(
  'clean source installation runs all five workflow operations, failure states and controlled evaluation',
  { timeout: 180000 },
  async (t) => {
    const box = fs.mkdtempSync(join(tmpdir(), 'shcontext clean skills '));
    t.after(() => fs.rmSync(box, { recursive: true, force: true }));
    const checkout = join(box, 'tool checkout');
    fs.mkdirSync(checkout);
    const listed = spawnSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.ifError(listed.error);
    assert.equal(listed.status, 0, listed.stderr);
    for (const path of listed.stdout.split('\0').filter(Boolean)) {
      assert.ok(!path.split('/').includes('..'));
      const target = join(checkout, path);
      fs.mkdirSync(dirname(target), { recursive: true });
      fs.copyFileSync(join(root, path), target);
    }
    assert.equal(fs.existsSync(join(checkout, 'node_modules')), false);
    assert.equal(fs.existsSync(join(checkout, 'dist')), false);
    const npm = process.env.npm_execpath;
    assert.ok(npm, 'Run through npm run test:skills or npm test.');
    const env = {
      ...process.env,
      OPENAI_API_KEY: '',
      npm_config_update_notifier: 'false',
    };
    function run(args, expected = 0, cwd = box) {
      const result = spawnSync(process.execPath, args, {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 90000,
      });
      assert.ifError(result.error);
      assert.equal(
        result.status,
        expected,
        `${result.stdout}\n${result.stderr}`,
      );
      return result;
    }
    run(
      [
        npm,
        'ci',
        '--cache',
        join(box, 'fresh npm cache'),
        '--no-audit',
        '--no-fund',
      ],
      0,
      checkout,
    );
    const cli = join(checkout, 'dist/cli/index.js');
    assert.match(
      run([
        join(checkout, 'examples/host-demo.mjs'),
        join(box, 'host source demo'),
      ]).stdout,
      /HOST WALKTHROUGH PASSED/,
    );
    assert.match(run([cli, '--help']).stdout, /build <directory>/);
    const repo = join(box, 'target repository');
    fs.mkdirSync(repo);
    const put = (path, content) => {
      fs.mkdirSync(dirname(join(repo, path)), { recursive: true });
      fs.writeFileSync(join(repo, path), content);
    };
    put(
      'shcontext.config.json',
      JSON.stringify({
        version: 1,
        provider: { id: 'openai', model: 'test-model' },
      }),
    );
    put('.shcontextignore', 'shcontext.config.json\n.shcontextignore\n');
    assert.equal(
      JSON.parse(run([cli, 'scan', repo]).stdout).coverage,
      'complete',
    );
    // The actual CLI build succeeds with no eligible bodies and therefore no model request.
    env.OPENAI_API_KEY = 'unused-test-key';
    const built = JSON.parse(run([cli, 'build', repo]).stdout);
    assert.equal(built.execution.requests, 0);
    env.OPENAI_API_KEY = '';
    assert.equal(JSON.parse(run([cli, 'verify', repo]).stdout).state, 'fresh');
    assert.equal(JSON.parse(run([cli, 'update', repo]).stdout).model_calls, 0);
    assert.equal(
      JSON.parse(
        run([cli, 'query', 'nonexistent', '--root', repo, '--json'], 2).stdout,
      ).status,
      'no_match',
    );

    // Exercise meaningful generated source through the documented injectable adapter API.
    // Live CLI model generation needs a separately authorized key and is not simulated here.
    put(
      'src/core/normalize.ts',
      'export function normalize(value: string) { return value.trim().toLowerCase(); }\n',
    );
    const { buildRepository, updateRepository } = await import(
      pathToFileURL(join(checkout, 'dist/index.js'))
    );
    const { fakeProvider } = await import(
      pathToFileURL(join(checkout, 'tests/helpers/generation.mjs'))
    );
    const first = await buildRepository(repo, { provider: fakeProvider() });
    assert.ok(first.execution.requests > 0);
    assert.equal(JSON.parse(run([cli, 'verify', repo]).stdout).state, 'fresh');
    const answer = JSON.parse(
      run([cli, 'query', 'normalize', '--root', repo, '--json']).stdout,
    );
    assert.equal(answer.status, 'answered');
    assert.ok(
      answer.matches.some((item) => item.path === 'src/core/normalize.ts'),
    );
    put(
      'src/core/normalize.ts',
      'export function normalize(value: string) { return value.trim(); }\n',
    );
    assert.equal(
      JSON.parse(run([cli, 'verify', repo], 1).stdout).state,
      'stale',
    );
    assert.equal(
      JSON.parse(
        run([cli, 'query', 'normalize', '--root', repo, '--json'], 1).stdout,
      ).status,
      'context_stale',
    );
    const manifest = fs.readFileSync(
      join(repo, 'context/.shcontext/manifest.json'),
    );
    const blocked = run(
      [
        cli,
        'update',
        repo,
        '--max-cost-usd',
        '0',
        '--input-usd-per-million',
        '1',
        '--output-usd-per-million',
        '1',
      ],
      1,
    );
    assert.match(blocked.stderr, /agent_budget/);
    assert.deepEqual(
      fs.readFileSync(join(repo, 'context/.shcontext/manifest.json')),
      manifest,
    );
    const updated = await updateRepository(repo, { provider: fakeProvider() });
    assert.equal(updated.changed, true);
    assert.equal(JSON.parse(run([cli, 'update', repo]).stdout).model_calls, 0);
    assert.equal(JSON.parse(run([cli, 'verify', repo]).stdout).state, 'fresh');
    const report = fs.readFileSync(
      join(checkout, 'benchmarks/agent-results.json'),
    );
    const evaluation = run([
      npm,
      '--prefix',
      checkout,
      'run',
      'benchmark:agents',
      '--',
      '--check',
    ]);
    assert.match(evaluation.stdout, /AGENT BENCHMARK PASSED/);
    assert.deepEqual(
      fs.readFileSync(join(checkout, 'benchmarks/agent-results.json')),
      report,
    );
  },
);
