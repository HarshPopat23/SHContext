import { parseArgs } from 'node:util';
import { scanRepository, ScanError } from '../scanner/index.js';
import { getProjectInfo } from '../core/index.js';

interface CliOutput {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const plannedCommands = new Set(['build', 'verify', 'update', 'query']);

function help(): string {
  return `SHContext — repository context generator (development foundation)

Usage: shcontext [options]

Options:
  -h, --help       Show this help message
  -v, --version    Show the package version

Commands:
  scan <directory>  Print a local JSON inventory without model calls or writes

Exit codes: 0 complete, 2 partial, 1 operational/configuration failure
Planned for v0.1: build, verify
Planned later: update, query

Design: https://github.com/HarshPopat23/SHContext/tree/main/docs
`;
}

/** Help/version are side-effect free; scan reads only the explicitly selected root. */
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
