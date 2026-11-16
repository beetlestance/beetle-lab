# Backend cleanup control evidence

Status: dedicated reservation locally checked; ACK/settlement remain separate.
Baseba69e40. [Contract](../design/lld/backend-cleanup-control.md).

The additional65,536 policy1 reserve uses the existing installation usage counter.
New performance delivery reserves it alongside the unchanged output allocation.
Legacy data is not backfilled or charged by migration; explicit top-up precedes
resumed file access and agent retirement requests. Existing output/source/absence
charges and finalization ownership are retained.

Dedicated tests exercise bucket arithmetic and maximal file-cell/ledger values,
actual claim rollback, shared capacity and raw SQL refusal, immutable replay/REPLACE,
actual schema20 preservation and late migration rollback, and compiled worker top-up/
reopen. Positively unsent Begin reserves its own cell without an output allocation.
One-byte-short legacy capacity refuses without changing charges or deletion progress.

Quota fixtures now account for the explicit extra control charge. Input/output race
contenders have equal logical costs; original exact-boundary and rollback assertions
remain. The shared claim fixture retains its original concurrent workload by providing
capacity for the newly declared reservation. Historical fixture seeding uses frozen
pre-policy admission through actual old guards, rather than today's schema21 service.
No production fallback or missing-ledger zero charge is introduced.

Initial focused17cases passed after accounting fixture corrections. Dedicated8cases
passed5.84s after a corrected migration table-constraint ordering error. Expanded
backend lane:598passed/62failed in222.59s. An untouchedba69e40 baseline selection
reproduced27 failures in117.38s;35 were current regressions. They were corrected
through scoped lanes, including106 then61 passing cases and a final9-case historical
fixture correction in2.23s. Current migration expectations also repaired two stale
baseline cases;25 unrelated baseline failures remain recorded, not a green full suite.

Final Node/frontend/runtime types16.80s, lint7.53s, architecture5.96s and docs.50s
exited0. The final fixture lint1.56s, fixture cases2.56s and API build.94s exited0.
History scalar joins include charged cleanup control once; no physical disk size is
inferred. Private source-bound check plans retain every failure and correction.
Independent review accepted accounting, guards, fixture assumptions and scope. Native whole-chain
cleanup remains separate; no user service or published image changed.

C5a0 now funds each new Run at receipt-first enqueue, before execution intent/outbox
publication. An insufficient installation pool rolls the entire enqueue back.
Advisory discovery and claim add only missing cleanup control, preserving exact
capacity for already funded originals. Legacy explicit top-up remains unchanged.
Queued originals therefore consume65,536 bytes before dispatch; queue slots do not
promise storage. Full-capacity positively unsent deletion reuses that allowance.

Focused42cases across8files passed20.10s, including compiled-worker Run mutations,
exact-capacity claim, enqueue failure/receipt replay, unsent deletion at full capacity
and historical migration preservation. Types27.33s, lint8.70s, architecture6.56s,
docs1.54s exited0. Initial failures preserved: two exploratory boundary fixtures;
then12 failures for new queued charges, unsafe SQL arithmetic and historical seeds;
then12 fixture runtime/installation consistency failures. Corrections preserve the
resource workload, explicit capacities and real historical guards. This adds no
refund, settlement, replay tombstone or public deletion behavior.

Later [historical fixture triage](migration-fixtures.md) resolves the recorded
baseline backlog with current scoped evidence; the original counts above remain historical.
