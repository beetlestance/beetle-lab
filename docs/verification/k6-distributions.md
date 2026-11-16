# k6 duration distributions

Status: locally implemented and independently reviewed. Contract:
[bounded distributions](../design/lld/k6-distributions.md).

## Implemented behavior

Trend totals and source-second windows contain immutable millisecond distributions.
Each histogram keeps at most 64 binary64 counters, downscales without losing counts,
and separates measured zero from missing data. Merge validates both populations;
p50/p90/p95/p99 return nearest-rank estimates with conservative bounds and actual
scale. These estimates never replace native final-summary threshold verdicts.

The numeric-final artifact uses private format version 2, preserving distributions
and provenance. Its existing 1 MiB cap and actual collection allowance remain in
force; insufficient space fails explicitly. No raw duration corpus or production
window history is retained. Standalone histogram JSON requires caller byte admission
before parsing; the in-process validator assumes bounded data objects.

## Checks and corrections

Scoped aggregation/composition/result checks passed 187 cases. Added distribution
controls and the affected attempt suite passed 60; final distribution/overflow
controls passed 18. These overlap and are not an additive test total. Changed lint,
Node TypeScript and architecture checks passed; the latter checked 1,593 files.
Coordinator review checked source hashes, implementation, independent sorted-sample
oracles, merge counts and command logs. Integration checks the actual numeric
artifact composition; no full-suite or native image rerun is claimed.

Review corrected an impossible positive bucket range when a population included
zero and removed a type import cycle. Initial new-test oracle/fixture, lint and
synthetic mutable-map type failures are retained in private evidence.

## Resource evidence and limits

The synthetic maximum-request fixture compiled 64 requests, 449 execution trends
and 650 retained numeric series, keeping at most three occupied source windows.
It produced a 256,441-byte numeric projection and a maximum 255,280-byte window.
Counter storage including one detached snapshot was 1,149,440 bytes. Explicit
counter/parser/serialization overlap accounting was 3,543,435 bytes.

These figures exclude complete JavaScript object/GC overhead and do not prove an
8 MiB whole-heap ceiling. The shared Vitest process observed a 16,619,320-byte
heap-used delta without controlled GC; it is not an isolated engine measurement.
The fixture exercises maximum request count, not every maximum label combination.
Native resource qualification remains outstanding; no budget was raised.

Executable window transport, public sample API, chart replay, target sampling,
browser and updated native image qualification remain separate unfinished work.

The pure value implementation moved to @beetle/contracts/metrics at `1b89ed7`
without changing the five algorithm modules' bytes. Existing distribution/engine
integration14 checks passed in3.14s and staged composition6 in2.51s. Node types,
changed lint, architecture1660 and docs271 passed; a context-line overflow was
corrected without changing its gate. This is ownership/import evidence, not new
numeric precision, browser, native resource or performance qualification.
