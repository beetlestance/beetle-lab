# Durable delivery closure storage evidence

Status: locally verified and independently reviewed source-backed Journal/Manager
components. HTTP transport and backend publication remain
required; this report does not establish a complete run path.

## Source and review

Implementation: `578da0189eaac1a559877f9d6121595c1678d736`, integrated at
`9a5a230094eff61fb755f49cde3ed6845a5972ae`. Independent review inspected all28
changed paths and matched39 required input hashes: no blocking defect. Review
elapsed150 seconds; no executable checks repeated. Contract:
[delivery closure](../design/lld/output-delivery-closure.md).

The worker captures the immutable final sequence only after exact durable source
and physical release validation. Migration013 adds delivery charge, native late
append/high-water fences and indexed released-source debt. ACK/prune does not
refund closure charge. Fixed-upper discovery reads compact keys before LIMIT.

## Scoped verification

78 distinct new passing cases accumulated across focused runs;25 selected
existing seams passed in12.64s. Initial new-group run:74passed/3failed,20.08s.
Failed/new selections:3passed/1failed4.78s, discovery failed1.37s, then passed1.78s.
Corrections used monotonic fixture observations, explicit output headroom and
normalized only reopen's documented observation reset. Historical standalone
schema assertions remain before explicitly migrating for current Store reads.

Changed-file lint passed1.00s. Node TypeScript initially failed7.44s on optional
test properties; erased test assertions corrected, test lint passed1.02s and
TypeScript passed7.03s. No full suite or Docker/build rerun.

Actual compiled worker oracles cover exact close/read/reopen, post-COMMIT withheld
reply, quota/rollback, retained charge, native forgery and unchanged persisted
state after forbidden late append. The inherited SQL error fails that Journal
unavailable; this is fail-closed refusal, not nonfatal conflict recovery. Withheld
reply evidence is not a process-crash test. Synthetic storage evidence does not
prove Manager/native producer drain or backend result eligibility.

The shared golden fixture was subsequently relocated byte-for-byte to the
contracts fixture owner. Coordinator verified all11 selected consuming vector/
Journal cases in2.76s, architecture1292 files in2.93s and documentation in0.18s.
No structural rule changed and no duplicated fixture was introduced.

## Manager and scheduler composition

Manager source `a2a8b1d` plus correction `0dc8421`, integrated at
`ab328b25ccd40ba173835c03ab666b57f7ea66ed`, wires actual completion leases,
retiring fences, preparation/watch/final cancellation/controller drains, exact
source release/closure and same-manager reconciliation. Scheduler's reviewed
three-lane discovery is recorded [separately](agent-scheduler.md).

Original Manager evidence:45 distinct focused passes,8.58s initial26 and11.26s
selected18passes/1failure, corrected reentry case1.62s; lint1.64s and0.74s,
Node TypeScript7.68s. Independent review169s found closed historical late calls
could retain undiscoverable owners. The correction's66-source compiled-Journal
oracle reproduced it, then proved automatic cleanup with no manual drive. Eight
selected correction cases passed across recorded runs, including retained prior
original, absent/unknown/mismatched closure recovery and actual private watch
callbacks assigning cancellation during close. Fixture failures and lint/type
corrections remain recorded; final Node TypeScript passed6.21s.

Coordinator independently inspected all nine correction paths/hashes in121s,
closed that blocker, and reused focused evidence. One integrated actual Manager/
native file/compiled-Journal barrier case passed2.13s after shared lifetime/root
composition; no full-suite repeat. Execution backend observations remain synthetic.
A producer-free late call hands off after its final producer lease into metadata
cleanup still owned by the same bounded public original. It fences native admission
and removes only on exact existing closure; absence/uncertainty retains ownership.
No source-free closure, backend publication, deletion/refund or native k6/platform
qualification is established by these component checks.
