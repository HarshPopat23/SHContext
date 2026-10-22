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
      npm_config_loglevel: 'error',
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

test(
  'packed package installs with a fresh cache and working bin, library and declarations',
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
        'dist/scanner/index.d.ts',
        'dist/generation/index.d.ts',
        'dist/providers/index.d.ts',
        'dist/validation/index.d.ts',
        'dist/update/index.d.ts',
        'dist/query/index.d.ts',
        'dist/agents/index.d.ts',
        'benchmarks/agent-results.md',
        'benchmarks/agent-results.json',
        '.claude-plugin/plugin.json',
        '.claude-plugin/marketplace.json',
        'docs/skills.md',
        'LICENSE',
      ]) {
        assert.ok(paths.includes(path), `Missing package entry: ${path}`);
      }
      for (const name of ['build', 'update', 'verify', 'query', 'benchmark']) {
        assert.ok(paths.includes(`skills/context-${name}/SKILL.md`));
        assert.ok(paths.includes(`skills/context-${name}/agents/openai.yaml`));
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
          '--prefer-offline',
          '--cache',
          join(sandbox, 'npm-cache'),
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

      runNode(
        [
          '--input-type=module',
          '--eval',
          "import { scanRepository } from 'shcontext/scanner'; const result = scanRepository('.'); if (!result.inventory.entries.some(entry => entry.path === 'package.json')) process.exitCode = 1;",
        ],
        consumer,
      );

      runNode(
        [
          '--input-type=module',
          '--eval',
          "import { analyzeRepository } from 'shcontext/analysis'; const report = analyzeRepository('.'); if (!report.configuration.some(item => item.path === 'package.json')) process.exitCode = 1;",
        ],
        consumer,
      );

      runNode(
        [
          '--input-type=module',
          '--eval',
          "import { buildRepository } from 'shcontext/generation'; import { OpenAIProvider } from 'shcontext/providers'; import { buildRepository as root } from 'shcontext'; if (root !== buildRepository || typeof OpenAIProvider !== 'function') process.exitCode=1;",
        ],
        consumer,
      );
      runNode(
        [
          '--input-type=module',
          '--eval',
          [
            "import { mkdirSync, writeFileSync } from 'node:fs';",
            "import { buildRepository } from 'shcontext/generation';",
            "import { OpenAIProvider } from 'shcontext/providers';",
            "mkdirSync('sample'); writeFileSync('sample/shcontext.config.json', JSON.stringify({version:1,provider:{id:'openai',model:'test-model'}}));",
            "writeFileSync('sample/.shcontextignore', 'shcontext.config.json\\n.shcontextignore\\n');",
            "import { verifyRepository } from 'shcontext/validation';",
            "const built = await buildRepository('sample', {provider:new OpenAIProvider({model:'test-model', apiKey:'test-unused'})});",
            "import { updateRepository } from 'shcontext/update';",
            "const updated = await updateRepository('sample'); if(updated.changed || updated.model_calls !== 0) process.exitCode=1;",
            "import { queryRepository } from 'shcontext/query';",
            "const queried = queryRepository('sample','nothing matches'); if(queried.status !== 'no_match') process.exitCode=1;",
            "import { AGENT_ROLES } from 'shcontext/agents'; if(Object.keys(AGENT_ROLES).length !== 4 || built.execution.requests !== 0) process.exitCode=1;",
            "if(verifyRepository('sample').state !== 'fresh') process.exitCode=1;",
            "if(built.bundle.folders.length !== 1 || built.bundle.inventory.coverage !== 'complete') process.exitCode=1;",
          ].join('\n'),
        ],
        consumer,
      );
      writeFileSync(
        join(consumer, 'consumer.mts'),
        [
          "import { queryRepository, type QueryResult } from 'shcontext/query';",
          "import { queryRepository as rootQuery } from 'shcontext';",
          "export const query = (): QueryResult => queryRepository('.', 'auth');",
          'export const sameQuery: typeof queryRepository = rootQuery;',
          "import { Coordinator, type ExecutionOptions, type AgentReview } from 'shcontext/agents';",
          'export const executionOptions: ExecutionOptions = {workers:4,budget:{maxRequests:20}};',
          'export const coordinator = (): Coordinator => new Coordinator(provider,executionOptions);',
          "export function reviewed(value: AgentReview): boolean {return value.status === 'no-issues-found';}",
          "import { updateRepository, type UpdateResult } from 'shcontext/update';",
          "import { updateRepository as rootUpdate } from 'shcontext';",
          "export const update = (): Promise<UpdateResult> => updateRepository('.', {provider});",
          'export const sameUpdate: typeof updateRepository = rootUpdate;',
          "import { verifyRepository } from 'shcontext/validation';",
          "import { type VerificationResult } from 'shcontext/contracts';",
          "export const verification: VerificationResult = verifyRepository('.');",
          "import { buildRepository, type BuildResult } from 'shcontext/generation';",
          "import { OpenAIProvider, type ModelProvider } from 'shcontext/providers';",
          "export const provider: ModelProvider = new OpenAIProvider({model: 'explicit-model', apiKey:'host-key'});",
          "export const build = (): Promise<BuildResult> => buildRepository('.', {provider});",
          "import { analyzeRepository } from 'shcontext/analysis';",
          "import { type RepositoryAnalysis } from 'shcontext/contracts';",
          "export const report: RepositoryAnalysis = analyzeRepository('.');",
          "import { scanRepository, type ScanResult } from 'shcontext/scanner';",
          "export const scan: ScanResult = scanRepository('.');",
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
