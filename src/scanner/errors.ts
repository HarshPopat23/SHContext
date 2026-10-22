export class ScanError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly path: string | null = null,
  ) {
    super(message);
    this.name = 'ScanError';
  }
}
