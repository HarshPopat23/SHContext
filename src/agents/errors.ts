import { BuildError } from '../generation/errors.js';
import type { ExecutionReport } from './types.js';
/** Failed attempts retain their reservations; this is not actual billed usage. */
export class AgentExecutionError extends BuildError {
  constructor(
    code: string,
    message: string,
    public readonly execution: ExecutionReport,
  ) {
    super(code, message);
    this.name = 'AgentExecutionError';
  }
}
