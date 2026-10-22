import { BuildError } from '../generation/errors.js';
import type {
  ModelProvider,
  ProviderLimits,
  ProviderTransport,
  SummaryRequest,
} from './types.js';

export const DEFAULT_PROVIDER_LIMITS: Readonly<ProviderLimits> = Object.freeze({
  timeoutMs: 60_000,
  contextWindowTokens: 81_920,
  maxInputTokens: 64_000,
  maxOutputTokens: 4_096,
  maxRunInputTokens: 256_000,
  maxRunOutputTokens: 32_768,
});
const endpoint = 'https://api.openai.com/v1/responses';
const responseByteLimit = 1_048_576;

const transport: ProviderTransport = async (request) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: request.signal as AbortSignal,
    redirect: 'error',
  });
  // Error bodies may contain echoed source; discard them without decoding/logging.
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status, body: '' };
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseByteLimit) throw new Error();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return {
    status: response.status,
    body: new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    ),
  };
};

/** One destination, no repository endpoints, no automatic retries or model fallback. */
export class OpenAIProvider implements ModelProvider {
  readonly identity: { id: string; model: string };
  readonly limits: Readonly<ProviderLimits>;
  readonly maxAttempts = 1;
  private inputReserved = 0;
  private outputReserved = 0;
  private readonly apiKey: string;
  private readonly send: ProviderTransport;

  constructor(options: {
    model: string;
    apiKey: string;
    limits?: Partial<ProviderLimits>;
    transport?: ProviderTransport;
  }) {
    if (
      typeof options.apiKey !== 'string' ||
      !options.apiKey ||
      /[\s\x00-\x1f\x7f]/.test(options.apiKey) ||
      typeof options.model !== 'string' ||
      !options.model ||
      options.model.length > 200 ||
      /[\x00-\x1f\x7f]/.test(options.model)
    )
      throw new BuildError(
        'provider_configuration',
        'OpenAI requires a model and a host-supplied API key.',
      );
    const limits = { ...DEFAULT_PROVIDER_LIMITS, ...options.limits };
    if (
      Object.keys(limits).some(
        (key) => !Object.hasOwn(DEFAULT_PROVIDER_LIMITS, key),
      ) ||
      Object.values(limits).some(
        (value) => !Number.isSafeInteger(value) || value < 1,
      ) ||
      limits.timeoutMs > 300_000 ||
      limits.maxRunInputTokens < limits.maxInputTokens ||
      limits.maxRunOutputTokens < limits.maxOutputTokens ||
      limits.maxOutputTokens > 32_768 ||
      limits.maxInputTokens >
        limits.contextWindowTokens - limits.maxOutputTokens
    )
      throw new BuildError(
        'provider_configuration',
        'Provider limits must be positive finite integers with adequate run ceilings; timeout is at most 300000 ms and output at most 32768 tokens.',
      );
    this.identity = Object.freeze({ id: 'openai', model: options.model });
    this.limits = Object.freeze(limits);
    this.apiKey = options.apiKey;
    this.send = options.transport ?? transport;
  }

  async generate(request: SummaryRequest): Promise<unknown> {
    if (request.signal?.aborted)
      throw new BuildError('cancelled', 'Build cancelled.');
    const body = JSON.stringify({
      model: this.identity.model,
      store: false,
      instructions: request.instructions,
      input: request.input,
      max_output_tokens: this.limits.maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: 'folder_draft',
          strict: true,
          schema: request.schema,
        },
      },
    });
    // UTF-8 bytes + framing headroom is deliberately conservative, not a tokenizer.
    const estimated = Buffer.byteLength(body, 'utf8') + 1_024;
    if (estimated > this.limits.maxInputTokens)
      throw new BuildError(
        'request_budget',
        'Folder evidence exceeds the conservative request token estimate; narrow the selected root or explicitly increase provider limits for the selected model. No input was truncated.',
      );
    if (
      this.inputReserved + estimated > this.limits.maxRunInputTokens ||
      this.outputReserved + this.limits.maxOutputTokens >
        this.limits.maxRunOutputTokens
    )
      throw new BuildError(
        'run_budget',
        'Build would exceed its provider run token ceiling; no additional request was sent.',
      );
    this.inputReserved += estimated;
    this.outputReserved += this.limits.maxOutputTokens;
    const controller = new AbortController();
    let timeout = false;
    const cancel = () => controller.abort();
    request.signal?.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () =>
            reject(
              new BuildError(
                timeout ? 'provider_timeout' : 'cancelled',
                timeout ? 'Provider request timed out.' : 'Build cancelled.',
              ),
            ),
          { once: true },
        );
        timer = setTimeout(() => {
          timeout = true;
          controller.abort();
        }, this.limits.timeoutMs);
      });
      if (request.signal?.aborted) controller.abort();
      const response = await Promise.race([
        this.send({
          url: endpoint,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        }),
        cancelled,
      ]);
      if (controller.signal.aborted) throw new Error();
      if (response.status < 200 || response.status >= 300)
        throw new BuildError(
          'provider_http',
          `OpenAI request failed with HTTP ${Number.isInteger(response.status) ? response.status : 'error'}; no response body was logged.`,
        );
      if (Buffer.byteLength(response.body) > responseByteLimit)
        throw new Error();
      const value = JSON.parse(response.body) as {
        status?: string;
        output?: {
          type?: string;
          content?: { type?: string; text?: string }[];
        }[];
      };
      if (value.status !== 'completed' || !Array.isArray(value.output))
        throw new BuildError(
          'provider_incomplete',
          'OpenAI did not return a completed response.',
        );
      const content = value.output.flatMap((item) =>
        item.type === 'message' && Array.isArray(item.content)
          ? item.content
          : [],
      );
      if (content.some((item) => item.type === 'refusal'))
        throw new BuildError(
          'provider_refusal',
          'OpenAI refused this summary request.',
        );
      const texts = content.filter((item) => item.type === 'output_text');
      if (texts.length !== 1 || typeof texts[0]?.text !== 'string')
        throw new Error();
      return JSON.parse(texts[0].text) as unknown;
    } catch (error) {
      if (error instanceof BuildError) throw error;
      throw new BuildError(
        'provider_response',
        'OpenAI request or structured response failed; no source or response payload was logged.',
      );
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', cancel);
    }
  }
}
