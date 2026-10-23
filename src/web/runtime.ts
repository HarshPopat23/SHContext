import {
  prepareRepository,
  submitRepository,
  finalizeRepository,
  readHostSubmission,
} from '../generation/host.js';
import { verifyRepository } from '../validation/index.js';
import { queryRepository } from '../query/index.js';
import { readOwnedTree } from '../storage/publication.js';
import { scanRepository } from '../scanner/index.js';

// Private web bridge: the public CLI and its provider behavior remain unchanged.
const [operation, root, session, argument] = process.argv.slice(2);
try {
  if (!root) throw new Error('A selected workspace root is required.');
  let result: unknown;
  switch (operation) {
    case 'scan': {
      const scan = scanRepository(root);
      result = {
        input_id: scan.inventory.input_id,
        coverage: scan.inventory.coverage,
      };
      break;
    }
    case 'prepare':
      if (!session) throw new Error('A session directory is required.');
      result = await prepareRepository(root, session, {
        update: argument === 'update',
      });
      break;
    case 'submit':
      if (!session || !argument)
        throw new Error('A session and draft envelope are required.');
      result = await submitRepository(
        root,
        session,
        readHostSubmission(argument),
      );
      break;
    case 'finalize':
      if (!session) throw new Error('A session directory is required.');
      result = await finalizeRepository(root, session);
      if ((result as { coverage: string }).coverage === 'partial')
        process.exitCode = 2;
      break;
    case 'verify': {
      const verification = verifyRepository(root);
      result = verification;
      process.exitCode =
        verification.state !== 'fresh'
          ? 1
          : verification.coverage === 'partial'
            ? 2
            : 0;
      break;
    }
    case 'query': {
      const answer = queryRepository(root, argument ?? '');
      result = answer;
      process.exitCode =
        answer.context.state !== 'fresh'
          ? 1
          : answer.status === 'no_match' ||
              answer.context.coverage === 'partial'
            ? 2
            : 0;
      break;
    }
    case 'owned': {
      const owned = readOwnedTree(root);
      if (!owned?.cache)
        throw new Error(
          'A valid owned context tree with incremental cache is required.',
        );
      result = { identity: owned.identity, coverage: owned.manifest.coverage };
      break;
    }
    default:
      throw new Error('Unknown web operation.');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      code: (error as { code?: string }).code ?? 'web_runtime',
      message: error instanceof Error ? error.message : 'Web runtime failed.',
    }),
  );
  process.exitCode = 1;
}
