# Retained metric reads and chart

Status: locally verified and coordinator-reviewed. This supplies sealed historical
metrics; live transport and release qualification remain required.
Contract: [metric history](../design/lld/run-metric-history.md).

## Source and behavior

Contracts `be593b2`, query adapter `b488d6b`, streaming digest port/client query
preservation `a635074` and fixed error mapping `422fde1` precede implementation
`818e4b9`, integrated as `b536df5`. The coordinator reviewed the 52 owned paths,
source hashes, existing-test amendments, fixtures and final cleanup-only diff.
The worker independently reviewed coordinator contracts and identified transport
and hashing prerequisites. The worker inherited the session model; its exact
runtime model identity was not exposed.

Authenticated catalogue/sample routes resolve the requested historical attempt.
Complete numeric/index reads verify SHA256; index parsing retains at most100 rows
and selected data uses one contiguous range no larger than8MiB. The service admits
one original operation without a queue, caps its deadline at30s and retains both
native result and settlement through cancellation/shutdown. No writer, event,
reservation or publication mutation is added.

The RunDetail chart selects one series, retains at most1,000 points/1MiB and makes
at most10 sequential sample requests per action. It preserves gaps, distinguishes
whole-run totals and estimated percentiles, and replaces older/latest views.
Shared admission and immutable retirement tokens fence selection/attempt changes
and StrictMode effects. Pending catalogue polling stops on ready/absence/error.

## Evidence and corrections

The positive fixture comes from actual staged wrapper composition with synthetic
native process/builder boundaries:3ms observations at0/3/6s source offsets. Exact
numeric/data/index bytes and descriptors were retained; sealed bytes were not
rewritten to match metadata. The final fixture SHA256 is
`d73ceedcf74a33c9656d1275f12b0899669d9f518fe2f4ee412625445f263e8a`.

| Scoped check | Actual outcome |
| --- | --- |
| Contract/capture/client boundary lane | 71 contract cases within an84-test/9-file lane passed,5.41s; later app-only refinements checked separately |
| Final service tests | 15 cases/4 files passed,9.35s |
| Final chart/actual RunDetail tests | 11 cases/3 files passed,8.26s |
| Existing adjacent artifact/activity tests | 55 cases passed,7.54s |
| Corrected existing detail cases | Only3 failing cases reran and passed,4.11s;6 other cases intentionally unselected |
| Final Node/web types | Passed,12.064s/4.821s; later test-only cleanup Node types passed,8.535s |
| Changed lint | Passed; cleanup-only lint passed,0.878s |
| Source structure/documentation | 1706 source files/275 documents passed before evidence-only updates |
| Coordinator native/metadata/auth TCP/client seam | Passed,3.84s; all795 frozen dependency hashes unchanged |

The TCP seam proves exact catalogue values, reverse pages, whole-window range
boundaries, authentication, foreign-organisation404, missing-custody503 and
unchanged charges/events. Integrated source hashes match the reviewed candidate.
Subsequent changes only guard test-setup cleanup; production and assertions are
identical, so the successful socket seam was reused.

Initial socket setup was sandbox-denied. Reviewed localhost execution then found
sample-only fields leaking into a strict artifact metadata query. Explicit
projection fixed the production issue; a similar test-only lookup was corrected.
Other review corrections covered inherited getters, exact single-observation/zero
arithmetic, percentile key order, future-format handling, bounded metadata capture,
uppercase identifiers, UI original retention and concurrent shutdown initiation.
Existing request-count assertions retain their exact values and exclude only the
new independently tested metric lane. No assertion/gate was weakened.

## Limits

The generic wire client exposes API completion, not settlement of an injected
fetch that ignores abort/deadline. Selection retirement retains the exposed API
original; this is not proof of underlying custom-fetch quiescence. Bootstrap
held-close ordering was reviewed but not independently fault-injected.

No full suite, Docker build, actual k6 execution, real-browser layout/navigation,
RSS/overhead, native architecture or release qualification follows from this
slice. One initial denied-listener setup may have left a bounded synthetic temp
root whose path was unlogged; subsequent fixture cleanup now covers setup failure.
No shared temporary-directory pruning was performed.

## Shared projection for live consumers

Numeric value projection moved to contracts/metrics in9864887. The ratio and
percentile calculation body is byte-identical to the reviewed history implementation;
the app retains its fixed unavailable error mapping. No live feed is claimed here.
Affected history checks passed3/3 after task-local dependency/cache resolution was
corrected; five other cases had passed initially and were not repeated. Node types,
scoped lint and architecture1733files passed. Full private failure/command and exact
body identity evidence is archived with the completed projection task. No image
rebuild or full suite was needed for this relocation.
