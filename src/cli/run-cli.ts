import { parseArgs } from 'node:util';
import { getProjectInfo } from '../core/index.js';

interface CliOutput {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const plannedCommands = new Set(['scan', 'build', 'verify', 'update', 'query']);

function help(): string {
  return `SHContext — repository context generator (development foundation)

Usage: shcontext [options]

Options:
  -h, --help       Show this help message
  -v, --version    Show the package version

Repository commands are not implemented yet.
Planned for v0.1: scan, build, verify
Planned later: update, query

Design: https://github.com/HarshPopat23/SHContext/tree/main/docs
`;
}

/** Parse CLI arguments without reading or changing the user's repository. */
export function runCli(args: string[], output: CliOutput): number {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      strict: true,
      allowPositionals: true,
    });

    const command = positionals[0];
    if (command !== undefined) {
      const message = plannedCommands.has(command)
        ? `Command ${JSON.stringify(command)} is not implemented in this foundation.`
        : `Unknown command ${JSON.stringify(command)}.`;
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
