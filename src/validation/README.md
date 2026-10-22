# Validation

Reserved for context schema, evidence, ownership and freshness checks.
No context verifier is implemented yet. Mechanical integrity does not establish
semantic truth. See the [format contract](../../docs/context-format.md).

Shared schemas and `validateContract` already validate data in memory. A future
filesystem verifier consumes those types and emits `ValidationFinding` records
inside `VerificationResult`; it must separately read bytes and evaluate freshness.
See the [handoff guide](../../docs/data-contracts.md).
