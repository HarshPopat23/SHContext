import { z } from 'zod';
import { BuildError } from '../generation/errors.js';
import { RetryableProviderError } from '../providers/errors.js';
import type {
  ModelProvider,
  SummaryRequest,
  CancellationSignal,
} from '../providers/index.js';
import type {
  AgentRole,
  CoordinatorOptions,
  ExecutionReport,
} from './types.js';
import { byteOrder } from '../scanner/filesystem.js';

export const DEFAULT_AGENT_BUDGET = Object.freeze({
  maxRequests: 64,
  maxInputTokens: 1_048_576,
  maxOutputTokens: 262_144,
  outputTokensPerRequest: 4096,
});
const integer = (max: number) => z.number().int().min(1).max(max);
const price = z.number().min(0).max(1_000_000);
const OptionsSchema = z
  .strictObject({
    workers: integer(8).default(1),
    maxRetries: z.number().int().min(0).max(2).default(0),
    retryDelayMs: z.number().int().min(0).max(1000).default(100),
    timeoutMs: integer(300000).default(60000),
    budget: z
      .strictObject({
        maxRequests: integer(10000).default(DEFAULT_AGENT_BUDGET.maxRequests),
        maxInputTokens: integer(1_000_000_000).default(
          DEFAULT_AGENT_BUDGET.maxInputTokens,
        ),
        maxOutputTokens: integer(1_000_000_000).default(
          DEFAULT_AGENT_BUDGET.maxOutputTokens,
        ),
        outputTokensPerRequest: integer(32768).default(
          DEFAULT_AGENT_BUDGET.outputTokensPerRequest,
        ),
        maxCostUSD: price.optional(),
        inputUSDPerMillion: price.optional(),
        outputUSDPerMillion: price.optional(),
      })
      .default({ ...DEFAULT_AGENT_BUDGET }),
  })
  .superRefine((value, ctx) => {
    const b = value.budget;
    if (
      (b.maxCostUSD !== undefined ||
        b.inputUSDPerMillion !== undefined ||
        b.outputUSDPerMillion !== undefined) &&
      (b.inputUSDPerMillion === undefined ||
        b.outputUSDPerMillion === undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Both caller-supplied prices are required for cost reservations.',
      });
  });

/** One coordinator reserves synchronously before dispatch; workers return records, never write output. */
export class Coordinator {
  readonly signal: CancellationSignal;
  readonly options: z.infer<typeof OptionsSchema>;
  private readonly controller = new AbortController();
  private readonly external: CancellationSignal | undefined;
  private readonly forward = () => this.controller.abort();
  private active = 0;
  private readonly stats: ExecutionReport;
  constructor(
    private readonly provider: ModelProvider,
    options: CoordinatorOptions = {},
  ) {
    const { signal, ...configuration } = options;
    const parsed = OptionsSchema.safeParse(configuration);
    if (!parsed.success)
      throw new BuildError(
        'agent_configuration',
        'Invalid worker, retry, timeout or spending limits; cost reservations require both caller-supplied prices.',
      );
    this.options = Object.freeze({
      ...parsed.data,
      budget: Object.freeze(parsed.data.budget),
    });
    this.signal = this.controller.signal;
    this.external = signal;
    signal?.addEventListener('abort', this.forward, { once: true });
    if (signal?.aborted) this.controller.abort();
    this.stats = {
      workers: this.options.workers,
      peak_requests: 0,
      requests: 0,
      retries: 0,
      reserved_input_tokens: 0,
      reserved_output_tokens: 0,
      reserved_cost_usd:
        this.options.budget.inputUSDPerMillion === undefined ? null : 0,
      tasks: [],
      reviews: [],
    };
  }
  check(): void {
    if (this.signal.aborted)
      throw new BuildError('cancelled', 'Agent execution cancelled.');
  }
  cancel(): void {
    this.controller.abort();
  }
  close(): void {
    this.external?.removeEventListener('abort', this.forward);
  }
  record(
    role: AgentRole,
    source_path: string,
    state: 'completed' | 'reused',
    requests = 0,
  ): void {
    this.stats.tasks.push({ role, source_path, state, requests });
  }
  report(): ExecutionReport {
    return {
      ...this.stats,
      tasks: [...this.stats.tasks].sort(
        (a, b) =>
          byteOrder(a.source_path, b.source_path) || byteOrder(a.role, b.role),
      ),
      reviews: [...this.stats.reviews],
    };
  }
  setReviews(reviews: ExecutionReport['reviews']): void {
    this.stats.reviews = reviews;
  }
  async generate(
    role: AgentRole,
    path: string,
    request: SummaryRequest,
  ): Promise<unknown> {
    this.check();
    let dispatched = 0;
    for (let attempt = 0; ; attempt++) {
      this.check();
      if (this.active >= this.options.workers)
        throw new BuildError(
          'agent_concurrency',
          'Dispatch independent work through coordinator.map so the worker bound cannot be exceeded.',
        );
      const b = this.options.budget,
        output = b.outputTokensPerRequest;
      // Conservative UTF-8 byte estimate includes schema/instructions/model and framing headroom.
      const input =
        Buffer.byteLength(
          JSON.stringify({
            model: this.provider.identity.model,
            instructions: request.instructions,
            input: request.input,
            schema: request.schema,
            max_output_tokens: output,
          }),
        ) + 2048;
      const cost =
        b.inputUSDPerMillion === undefined
          ? null
          : (input * b.inputUSDPerMillion + output * b.outputUSDPerMillion!) /
            1_000_000;
      if (
        this.stats.requests + 1 > b.maxRequests ||
        this.stats.reserved_input_tokens + input > b.maxInputTokens ||
        this.stats.reserved_output_tokens + output > b.maxOutputTokens ||
        (b.maxCostUSD !== undefined &&
          this.stats.reserved_cost_usd! + cost! > b.maxCostUSD)
      )
        throw new BuildError(
          'agent_budget',
          'Agent request would exceed a request, input, output or caller-priced spending reservation; no additional request was sent.',
        );
      dispatched++;
      this.stats.requests++;
      this.stats.reserved_input_tokens += input;
      this.stats.reserved_output_tokens += output;
      if (cost !== null) this.stats.reserved_cost_usd! += cost;
      this.active++;
      this.stats.peak_requests = Math.max(
        this.stats.peak_requests,
        this.active,
      );
      const controller = new AbortController();
      const cancel = () => controller.abort();
      this.signal.addEventListener('abort', cancel, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const stopped = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () =>
              reject(
                new BuildError(
                  timedOut ? 'agent_timeout' : 'cancelled',
                  timedOut
                    ? 'Agent request timed out; previous context was retained.'
                    : 'Agent execution cancelled.',
                ),
              ),
            { once: true },
          );
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.options.timeoutMs);
        });
        if (this.signal.aborted) controller.abort();
        this.check();
        const result = await Promise.race([
          this.provider.generate({
            ...request,
            role,
            max_output_tokens: output,
            signal: controller.signal,
          }),
          stopped,
        ]);
        this.check();
        this.record(role, path, 'completed', dispatched);
        return result;
      } catch (error) {
        if (
          !(error instanceof RetryableProviderError) ||
          attempt >= this.options.maxRetries ||
          this.signal.aborted
        )
          throw error;
      } finally {
        clearTimeout(timer);
        this.signal.removeEventListener('abort', cancel);
        this.active--;
      }
      this.stats.retries++;
      await this.delay(
        Math.min(1000, this.options.retryDelayMs * 2 ** attempt),
      );
    }
  }
  private async delay(ms: number): Promise<void> {
    this.check();
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        this.signal.removeEventListener('abort', abort);
        reject(new BuildError('cancelled', 'Agent execution cancelled.'));
      };
      const timer = setTimeout(finish, ms);
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
    });
  }
  async map<T, R>(
    items: readonly T[],
    work: (item: T) => Promise<R>,
  ): Promise<R[]> {
    let cursor = 0,
      failure: unknown;
    const results: R[] = new Array(items.length);
    await Promise.all(
      Array.from(
        { length: Math.min(this.options.workers, items.length) },
        async () => {
          while (cursor < items.length && failure === undefined) {
            const index = cursor++;
            try {
              this.check();
              results[index] = await work(items[index]!);
            } catch (error) {
              if (failure === undefined) failure = error;
              this.cancel();
            }
          }
        },
      ),
    );
    if (failure !== undefined) throw failure;
    this.check();
    return results;
  }
}
