# Private bounded retirement pipeline

Status: C4b process-local composition implemented; no HTTP route, backend ACK,
refund or background job runner. Parents: [wire](retirement-wire.md),
[receipt](native-receipt.md), [retirement](output-retirement.md).

Root always composes the actual producer, runtime, inventory, native removal and
receipt owners with the exclusively opened Journal. Reserve at mosttwo pipeline
origins BEFORE request/operation capture; snapshot a fixed <=30second budget and
closed retirement request. Exact same-scope/digest calls share the original work;
changed binding conflicts. At full capacity, refusal occurs before capture even for
a duplicate, rather than invoking untrusted input to identify it.

Await C2 result AND actual settled carrier/drain, then require a genuine producer
barrier before runtime removal. Recheck the outer budget after each helper and
before another phase. Read the original's existing plan; only when absent may actual
inventory prepare, finish original quiescence/cached close and persist its opaque
observation. Never build a fresh plan from a partially removed task. Existing plan
recovery follows the same persisted identities/progress.

Perform at most16 reverse-plan steps per tick (trusted composition may choose1..16).
A completed bounded batch with remaining work yields a request-bound pending reply.
Only after files_absent may trusted receipt finalization run and produce cleaned.
Finalization still checks current native absence on replay; no raw row/counter shortcut.
Check budget before finalization and cleaned publication. Replies expose only the
closed wire identity/digests, no paths/config/native facts or stage diagnostics.

Malformed/binding-conflicting/corrupt durable state and deadline/cancellation are
failures, never converted to pending or cleaned. No early timeout-pending timer is
used: an issued kernel operation ignoring abort may keep the result pending until
actual settlement. Future HTTP carrier code must preserve that original independently
of socket expiry. Callers drive additional bounded ticks; this class starts no
background continuation or repeated target work.

Work.settled reflects issued helper calls, rejects failures and never means successful
native close/drain. Directly owned inventory close failure or unproven Journal carrier
termination retains the pipeline entry. Known helper failures can settle while their
explicit native owners remain quarantined; those owners must still close successfully
before Root releases the installation/Journal. Shutdown closes the pipeline first,
waits actual calls and refuses unknown retained entries, then closes the actual
receipt/removal/inventory/runtime/producer owners in order. allSettled is not proof
that rejected closes succeeded.

Acceptance: actual Journal/files and genuine capabilities through cleaned/replay;
reappeared root refusal; pending batch/resume/same plan; no new create/start; malformed
and scope/digest conflict; expired budget; coalescing; capacity before traps; held late
open across abort/close and corrupted reply failure. Portable fake-Docker composition
is distinct from native runner/backend cleanup qualification and authorization.
