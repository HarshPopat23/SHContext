# Core

The reusable library exposes package identity through `getProjectInfo` and shared
runtime schemas/inferred types in `contracts/`. Keep CLI execution and provider
credentials out of public library imports. Configuration-file loading, hashing
and the pipeline are not implemented yet. See the
[contract guide](../../docs/data-contracts.md).
