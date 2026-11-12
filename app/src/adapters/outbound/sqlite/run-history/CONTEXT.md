# Derived run history

HistorySummaries owns private scan/defer/commit operations and immutable <=2048-byte
projections under metadata transactions. Due scans use the partial terminal/pending
index and return <=16 keys. Scoped source/absence digests plus active attempt and
expected due-time bind CAS; equal replay preserves one value. Migration018 validates
closed public summaries and exact published numeric/catalogue facts in SQL guards.
No file operations, terminal transitions, refunds or engine effects.
readHistorySummaries joins compact facts/allocations for <=100 selected Run rows
under the caller's read transaction. Logical allowance subtracts only existing
source/absence receipt refunds; published bytes remain historical catalogue facts.
Wire originals retain failed-worker termination; the shared store stays externally
owned. Owning contract: docs/design/lld/run-history-summary.md.
Focused tests: app/test/storage/run-history-summary and history indexing fixtures.
