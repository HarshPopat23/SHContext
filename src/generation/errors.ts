/** Safe, stable diagnostics; never include model responses, source or transport errors. */
export class BuildError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BuildError';
  }
}
