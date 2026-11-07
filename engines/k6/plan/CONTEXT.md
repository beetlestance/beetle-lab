# Runtime-neutral execution plan

Public entrypoint `index.ts` owns schema-derived load/suite types and validation
brands, fixed compiler failure results, deterministic request/dataset selection
and metric admission. Compiler entrypoints forward to this owner.

Effects: none. Random selection uses an explicit callback. The only external type
dependency is declaration-level imports from compiler/generated/types.
Metric admission rejects unsupported metric/stat pairs and more than 200 distinct
tag maps before execution; requests and assertions use deterministic rN/aN labels.
Checks: scoped engine Vitest tests and the runtime TypeScript project.
