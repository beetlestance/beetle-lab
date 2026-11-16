# Runtime-neutral execution plan

Public entrypoint `index.ts` owns schema-derived load/suite types and validation
brands, fixed compiler failure results, deterministic request/dataset selection
and metric admission. Compiler entrypoints forward to this owner.
VU positions accept positive safe integer global identities, independently of
per-scenario concurrency. Counters allocate by selection entries, never VU ID;
dataset row selection uses modulo without an identity-sized allocation.

Effects: none. Random selection uses an explicit callback. External type dependencies are declaration-level imports from compiler/generated/types
and shared numeric metric types in @beetle/contracts/metrics; all erase at runtime.
Metric admission rejects unsupported metric/stat pairs and more than 200 distinct
tag maps before execution; requests and assertions use deterministic rN/aN labels.
`measureStartedMetric` is reserved control evidence; user SLO/discovery rules cannot
override it. It shares the aggregate tag map and adds no request/assertion labels.
Checks: scoped engine Vitest tests and the runtime TypeScript project.

`metricEvidenceLayout` is the pure owner of exact allowed native series and final
projection keys, native phase-first submetric spelling, scope, threshold rules
and denominator provenance. The original 200 label budget is unchanged; exact
per-metric series remain <=4600 without Cartesian expansion.
