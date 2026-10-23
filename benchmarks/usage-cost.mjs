export function usageCost(usage, prices) {
  for (const field of ['input', 'cached', 'write', 'output'])
    if (!Number.isFinite(prices[field]) || prices[field] < 0)
      throw Error('All four caller prices must be finite and nonnegative.');
  if (
    usage.overflowed ||
    usage.in_flight_requests ||
    usage.unreported_requests ||
    usage.unknown_input_breakdown_requests
  )
    return {
      usd: null,
      complete: false,
      basis:
        'Unknown request usage or input-cache breakdown; no total cost is inferred.',
    };
  const ordinary =
    usage.input_tokens -
    usage.cached_input_tokens -
    usage.cache_write_input_tokens;
  return {
    usd:
      (ordinary * prices.input +
        usage.cached_input_tokens * prices.cached +
        usage.cache_write_input_tokens * prices.write +
        usage.output_tokens * prices.output) /
      1_000_000,
    complete: true,
    basis:
      'Provider-reported tokens at caller-supplied ordinary/cached/cache-write/output prices; reasoning is included in output, not charged twice. Assumes those rates apply to all reported categories; not an invoice.',
  };
}
