# Providers

Bounded OpenAI Responses adapter and typed provider interface. See [generation](../../docs/generation.md) for host credentials, the fixed destination, finite budgets, cancellation and the one-attempt policy.

The optional coordinator can retry only settled `RetryableProviderError` failures.
Adapters must honor `SummaryRequest.max_output_tokens` and cancellation. Role
metadata distinguishes Folder Analyst, Architecture Analyst and source Verifier
requests; responses stay untrusted and locally validated. See [execution and
spending limits](../../docs/agents.md).
