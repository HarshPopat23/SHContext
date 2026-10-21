import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      npm_config_update_notifier: 'false',
      npm_config_loglevel: 'silent',
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

test(
  'packed package installs offline with a working bin, library and declarations',
  { timeout: 180_000 },
  () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'shcontext package '));
    const npm = process.env.npm_execpath;
    assert.ok(
      npm,
      'Run the suite through npm test so npm_execpath is available.',
    );
    try {
      const packed = JSON.parse(
        runNode([npm, 'pack', '--json', '--pack-destination', sandbox], root)
          .stdout,
      )[0];
      const paths = packed.files.map((entry) => entry.path);
      for (const path of [
        'dist/cli/index.js',
        'dist/index.js',
        'dist/index.d.ts',
        'dist/core/index.d.ts',
        'LICENSE',
      ]) {
        assert.ok(paths.includes(path), `Missing package entry: ${path}`);
      }
      assert.ok(
        paths.includes('src/core/project-info.ts'),
        'Declaration maps need their source files.',
      );
      assert.ok(paths.includes('dist/core/contracts/index.d.ts'));
      assert.ok(
        !paths.some((path) => /^(tests|node_modules|\.github)\//.test(path)),
      );
      assert.ok(!paths.includes('package-lock.json'));

      const consumer = join(sandbox, 'consumer');
      mkdirSync(consumer);
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ private: true, type: 'module' }),
      );
      runNode(
        [
          npm,
          'install',
          '--offline',
          '--ignore-scripts',
          '--omit=dev',
          '--no-audit',
          '--no-fund',
          join(sandbox, packed.filename),
        ],
        consumer,
      );

      const help = runNode(
        [npm, 'exec', '--offline', '--', 'shcontext', '--help'],
        consumer,
      );
      assert.match(help.stdout, /Usage: shcontext \[options\]/);
      const library = runNode(
        [
          '--input-type=module',
          '--eval',
          "import { getProjectInfo } from 'shcontext'; import { getProjectInfo as core } from 'shcontext/core'; if (getProjectInfo().name !== 'shcontext' || core !== getProjectInfo) process.exitCode = 1;",
        ],
        consumer,
      );
      assert.equal(library.stdout, '');
      assert.equal(library.stderr, '');
      runNode(
        [
          '--input-type=module',
          '--eval',
          "import { validateContract } from 'shcontext/contracts'; if (validateContract('fileAnalysis', {}).success) process.exitCode = 1;",
        ],
        consumer,
      );

      writeFileSync(
        join(consumer, 'consumer.mts'),
        [
          "import { getProjectInfo, type ProjectInfo } from 'shcontext';",
          "import { getProjectInfo as core } from 'shcontext/core';",
          'export const info: ProjectInfo = getProjectInfo();',
          'export const name: string = core().name;',
          "import { validateContract, type DependencyEdge } from 'shcontext/contracts';",
          "export const checked = validateContract('repositoryInventory', {});",
          'if (checked.success) { const count: number = checked.data.entries.length; void count; }',
          'export function target(edge: DependencyEdge): string | null {',
          "  if (edge.resolution === 'resolved') return edge.to;",
          '  const empty: null = edge.to; return empty;',
          '}',
          '// @ts-expect-error Unknown contract names are rejected statically.',
          "validateContract('inventedContract', {});",
          '// @ts-expect-error Payload is unavailable before success narrowing.',
          "validateContract('fileAnalysis', {}).data;",
        ].join('\n'),
      );
      runNode(
        [
          join(root, 'node_modules/typescript/bin/tsc'),
          '--noEmit',
          '--strict',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2022',
          'consumer.mts',
        ],
        consumer,
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  },
);
