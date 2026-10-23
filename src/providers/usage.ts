import type { ProviderUsage } from './types.js';

export const EMPTY_USAGE: Readonly<ProviderUsage> = Object.freeze({
  in_flight_requests: 0,
  reported_requests: 0,
  unreported_requests: 0,
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  reasoning_output_tokens: 0,
  unknown_input_breakdown_requests: 0,
  unknown_reasoning_breakdown_requests: 0,
  overflowed: false,
});
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const token = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 1_000_000_000;

/** Never lets untrusted accounting metadata invalidate an otherwise usable summary. */
export function addUsage(previous: ProviderUsage, raw: unknown): ProviderUsage {
  const value = object(raw),
    input = value?.['input_tokens'],
    output = value?.['output_tokens'];
  let next: ProviderUsage;
  if (
    !token(input) ||
    !token(output) ||
    (value?.['total_tokens'] !== undefined &&
      value['total_tokens'] !== input + output)
  ) {
    next = {
      ...previous,
      unreported_requests: previous.unreported_requests + 1,
    };
  } else {
    const details = object(value?.['input_tokens_details']);
    const cached = details?.['cached_tokens'],
      written = details?.['cache_write_tokens'];
    const reasoning = object(value?.['output_tokens_details'])?.[
      'reasoning_tokens'
    ];
    const inputKnown =
      token(cached) && token(written) && cached + written <= input;
    const reasoningKnown = token(reasoning) && reasoning <= output;
    next = {
      ...previous,
      reported_requests: previous.reported_requests + 1,
      input_tokens: previous.input_tokens + input,
      output_tokens: previous.output_tokens + output,
      cached_input_tokens:
        previous.cached_input_tokens + (inputKnown ? cached : 0),
      cache_write_input_tokens:
        previous.cache_write_input_tokens + (inputKnown ? written : 0),
      reasoning_output_tokens:
        previous.reasoning_output_tokens + (reasoningKnown ? reasoning : 0),
      unknown_input_breakdown_requests:
        previous.unknown_input_breakdown_requests + Number(!inputKnown),
      unknown_reasoning_breakdown_requests:
        previous.unknown_reasoning_breakdown_requests + Number(!reasoningKnown),
    };
  }
  if (
    Object.values(next).some(
      (value) => typeof value === 'number' && !Number.isSafeInteger(value),
    )
  )
    return { ...previous, overflowed: true };
  return next;
}
