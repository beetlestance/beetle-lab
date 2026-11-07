# Runtime-neutral execution plan

Public entrypoint `index.ts` owns schema-derived load/suite types and validation
brands, fixed compiler failure results, deterministic request/dataset selection
and metric admission. Compiler entrypoints forward to this owner.
VU positions accept positive safe integer global identities, independently of
per-scenario concurrency. Counters allocate by selection entries, never VU ID;
dataset row selection uses modulo without an identity-sized allocation.

Effects: none. Random selection uses an explicit callback. The only external type
dependency is declaration-level imports from compiler/generated/types.
Metric admission rejects unsupported metric/stat pairs and more than 200 distinct
tag maps before execution; requests and assertions use deterministic rN/aN labels.
Checks: scoped engine Vitest tests and the runtime TypeScript project.
