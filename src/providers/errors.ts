import { BuildError } from '../generation/errors.js';
/** Only settled, explicitly transient failures may be retried by the coordinator. */
export class RetryableProviderError extends BuildError {
  constructor(
    code = 'provider_retryable',
    message = 'Provider reported a transient failure.',
  ) {
    super(code, message);
    this.name = 'RetryableProviderError';
  }
}
