# Durable delivery closure storage evidence

Status: locally verified and independently reviewed Journal component. Producer
quiescence, scheduler integration, HTTP transport and backend publication remain
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
