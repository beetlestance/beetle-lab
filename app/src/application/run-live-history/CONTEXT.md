# Active history service

One retained original and a 30 s request budget; no cache, background scan or retry.
The shared live-attempt capture resolves current scope/run/attempt and physical
binding before and after the remote read. A cancelled, terminal, changed or foreign
binding refuses the result. Shared history capture checks subset and prefix scope.
The installed agent verifies native prefix bytes; this service does not relabel
samples as sealed publication or crash durability.

Caller abort/deadline may return before the original; the map retains its slot
until metadata and gateway originals settle. Close fences intake, aborts hints and
drains retained promises. No mutation, accounting update or engine restart occurs.
Contract: docs/system/contracts/active-history.md.
Focused tests: app/test/run-live-history/service.test.ts.
