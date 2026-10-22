# Agent roles

Coordinator, Folder Analyst, Architecture Analyst and Verifier execute within
one pipeline and one writer. Folder jobs are sequential by default, with an
opt-in bounded async pool. `coordinator.ts` owns dispatch/cancellation/reservations;
`verifier.ts` separates source consistency from optional model-assisted review.
See [roles and execution](../../docs/agents.md) for limits and accounting.
