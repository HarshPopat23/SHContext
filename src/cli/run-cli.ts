import { updateRepository, type UpdateResult } from '../update/index.js';
import { queryRepository, QueryError } from '../query/index.js';
import { AgentExecutionError } from '../agents/errors.js';
import { ReviewError } from '../agents/verifier.js';
import { parseArgs } from 'node:util';
import { scanRepository, ScanError } from '../scanner/index.js';
import { getProjectInfo } from '../core/index.js';
import { verifyRepository } from '../validation/index.js';
import { buildRepository, BuildError } from '../generation/index.js';

interface CliOutput {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function help(): string {
  return `SHContext — repository context generator (alpha)

Usage: shcontext [options]

Options:
  -h, --help       Show this help message
  -v, --version    Show the package version

Commands:
  scan <directory>   Print a local JSON inventory without model calls or writes
  build <directory>  Generate context/ using the configured OpenAI model
  update <directory> Refresh affected summaries using the structured cache
  query <question>   Search context and inspected source (defaults to current directory)
  verify <directory> Check context integrity and freshness offline (read-only)

Exit codes: 0 complete, 2 partial, 1 operational/configuration failure
Query options: --root <directory>, --limit <1–20>, --depth <0–3>, --json
Build/update options: --workers <1–8> (default 1), --retries <0–2>, --review
  --max-requests <n>, --max-input-tokens <n>, --max-output-tokens <n>
  --max-cost-usd <amount> requires --input-usd-per-million and --output-usd-per-million

Design: https://github.com/HarshPopat23/SHContext/tree/main/docs
`;
}

/** Help/version are side-effect free; scan reads only the explicitly selected root. */
export async function runCli(
  args: string[],
  output: CliOutput,
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        root: { type: 'string' },
        limit: { type: 'string' },
        depth: { type: 'string' },
        json: { type: 'boolean' },
        workers: { type: 'string' },
        retries: { type: 'string' },
        review: { type: 'boolean' },
        'max-requests': { type: 'string' },
        'max-input-tokens': { type: 'string' },
        'max-output-tokens': { type: 'string' },
        'max-cost-usd': { type: 'string' },
        'input-usd-per-million': { type: 'string' },
        'output-usd-per-million': { type: 'string' },
      },
      strict: true,
      allowPositionals: true,
    });

    const command = positionals[0];
    const queryFlags = ['root', 'limit', 'depth', 'json'] as const;
    const agentFlags = [
      'workers',
      'retries',
      'review',
      'max-requests',
      'max-input-tokens',
      'max-output-tokens',
      'max-cost-usd',
      'input-usd-per-million',
      'output-usd-per-million',
    ] as const;
    if (
      !values.help &&
      ((command !== 'query' &&
        queryFlags.some((key) => values[key] !== undefined)) ||
        (!['build', 'update'].includes(command ?? '') &&
          agentFlags.some((key) => values[key] !== undefined)))
    ) {
      output.stderr(
        'Options do not apply to this command. Run shcontext --help.\n',
      );
      return 1;
    }
    const number = (value: string | undefined) =>
      value === undefined
        ? undefined
        : /^\d+(?:\.\d+)?$/.test(value)
          ? Number(value)
          : NaN;
    if (command === 'query') {
      if (values.help) {
        output.stdout(help());
        return 0;
      }
      if (positionals.length !== 2 || values.version) {
        output.stderr(
          'Usage: shcontext query "question" [--root directory] [--json]\n',
        );
        return 1;
      }
      try {
        const result = queryRepository(
          values.root ?? process.cwd(),
          positionals[1]!,
          {
            ...(values.limit !== undefined
              ? { limit: number(values.limit)! }
              : {}),
            ...(values.depth !== undefined
              ? { depth: number(values.depth)! }
              : {}),
          },
        );
        output.stdout(
          values.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `${result.answer}\n`,
        );
        output.stderr(
          `Query ${result.status}; context ${result.context.state}; source references require behavioral review.\n`,
        );
        return result.context.state !== 'fresh'
          ? 1
          : result.status === 'no_match' ||
              result.context.coverage === 'partial'
            ? 2
            : 0;
      } catch (error) {
        output.stderr(
          `${JSON.stringify(error instanceof QueryError || error instanceof ScanError ? { code: error.code, message: error.message } : { code: 'query_failed', message: 'Query could not obtain a stable selected-source snapshot.' })}\n`,
        );
        return 1;
      }
    }
    if (command === 'verify') {
      if (values.help) {
        output.stdout(help());
        return 0;
      }
      if (positionals.length !== 2 || values.version) {
        output.stderr(
          'Usage: shcontext verify <directory>\nRun shcontext --help for available options.\n',
        );
        return 1;
      }
      const result = verifyRepository(positionals[1]!);
      output.stdout(`${JSON.stringify(result, null, 2)}\n`);
      output.stderr(
        `Verify ${result.state}; coverage ${result.coverage}. Mechanical checks do not establish explanation accuracy; review claims against source.\n`,
      );
      return result.state === 'fresh'
        ? result.coverage === 'partial'
          ? 2
          : 0
        : 1;
    }
    if (command === 'build' || command === 'update') {
      if (values.help) {
        output.stdout(help());
        return 0;
      }
      if (positionals.length !== 2 || values.version) {
        output.stderr(
          `Usage: shcontext ${command} <directory>\nRun shcontext --help for available options.\n`,
        );
        return 1;
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      try {
        const result = await (
          command === 'update' ? updateRepository : buildRepository
        )(positionals[1]!, {
          signal: controller.signal,
          ...(values.review !== undefined ? { review: values.review } : {}),
          execution: {
            ...(values.workers !== undefined
              ? { workers: number(values.workers)! }
              : {}),
            ...(values.retries !== undefined
              ? { maxRetries: number(values.retries)! }
              : {}),
            budget: {
              ...Object.fromEntries(
                [
                  ['maxRequests', values['max-requests']],
                  ['maxInputTokens', values['max-input-tokens']],
                  ['maxOutputTokens', values['max-output-tokens']],
                  ['maxCostUSD', values['max-cost-usd']],
                  ['inputUSDPerMillion', values['input-usd-per-million']],
                  ['outputUSDPerMillion', values['output-usd-per-million']],
                ]
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => [key, number(value)]),
              ),
            },
          },
        });
        const updated = command === 'update' ? (result as UpdateResult) : null;
        output.stdout(
          `${JSON.stringify({ schema_version: 1, input_id: result.bundle.inventory.input_id, coverage: result.bundle.inventory.coverage, output_paths: result.output_paths, execution: result.execution, ...(updated ? { changed: updated.changed, regenerated: updated.regenerated, reused: updated.reused, model_calls: updated.model_calls, changes: updated.changes } : {}) }, null, 2)}\n`,
        );
        output.stderr(
          updated
            ? `Update ${result.bundle.inventory.coverage}: ${updated.regenerated.length} refreshed, ${updated.reused.length} reused; ${updated.model_calls} model calls; context ${updated.changed ? 'published' : 'unchanged'}. Review citations before committing context/.\n`
            : `Build ${result.bundle.inventory.coverage}: ${result.bundle.folders.length} folder summaries published. Review citations before committing context/.\n`,
        );
        return result.bundle.inventory.coverage === 'partial' ? 2 : 0;
      } catch (error) {
        const diagnostic =
          error instanceof BuildError || error instanceof ScanError
            ? {
                code: error.code,
                message: error.message,
                ...(error instanceof AgentExecutionError ||
                error instanceof ReviewError
                  ? { execution: error.execution }
                  : {}),
                ...(error instanceof ReviewError
                  ? { reviews: error.reviews }
                  : {}),
              }
            : {
                code: command === 'update' ? 'update_failed' : 'build_failed',
                message:
                  command === 'update'
                    ? 'Update failed; inspect context and publication state before retrying.'
                    : 'Build failed without publishing a new context tree.',
              };
        output.stderr(`${JSON.stringify(diagnostic)}\n`);
        return 1;
      } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
    }
    if (command === 'scan') {
      if (values.help) {
        output.stdout(help());
        return 0;
      }
      if (positionals.length !== 2 || values.version) {
        output.stderr(
          'Usage: shcontext scan <directory>\nRun shcontext --help for available options.\n',
        );
        return 1;
      }
      try {
        const { inventory } = scanRepository(positionals[1]!);
        output.stdout(`${JSON.stringify(inventory, null, 2)}\n`);
        output.stderr(
          `Scan ${inventory.coverage}: ${inventory.entries.length} observed entries.\n`,
        );
        return inventory.coverage === 'partial' ? 2 : 0;
      } catch (error) {
        const diagnostic =
          error instanceof ScanError
            ? { code: error.code, path: error.path, message: error.message }
            : {
                code: 'scan_failed',
                path: null,
                message: 'Scan failed without producing an inventory.',
              };
        output.stderr(`${JSON.stringify(diagnostic)}\n`);
        return 1;
      }
    }
    if (command !== undefined) {
      const message = `Unknown command ${JSON.stringify(command)}.`;
      output.stderr(
        `${message}\nRun shcontext --help for available options.\n`,
      );
      return 1;
    }

    if (values.help || args.length === 0) {
      output.stdout(help());
      return 0;
    }

    if (values.version) {
      output.stdout(`${getProjectInfo().version}\n`);
      return 0;
    }

    output.stderr('No operation selected. Run shcontext --help.\n');
    return 1;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid arguments.';
    output.stderr(`${message}\nRun shcontext --help for available options.\n`);
    return 1;
  }
}
