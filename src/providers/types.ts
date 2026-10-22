/** Structural cancellation interface keeps consumer declarations independent of Node/DOM types. */
export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
export interface SummaryRequest {
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  signal?: CancellationSignal;
}
export interface ModelProvider {
  readonly identity: { id: string; model: string };
  /** Returns untrusted decoded JSON, never Markdown. Implementations must bound their work. */
  generate(request: SummaryRequest): Promise<unknown>;
}
export interface ProviderLimits {
  timeoutMs: number;
  contextWindowTokens: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxRunInputTokens: number;
  maxRunOutputTokens: number;
}
export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: CancellationSignal;
}
export interface TransportResponse {
  status: number;
  body: string;
}
export type ProviderTransport = (
  request: TransportRequest,
) => Promise<TransportResponse>;
