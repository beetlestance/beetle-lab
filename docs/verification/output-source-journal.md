# Durable output source Journal

Status: reviewed local storage component. Controller lifecycle wiring, native
collection composition and backend artifact transfer remain required. The v2
controller's former generic finished-release call now refuses; the legacy app is
preserved. This report does not establish a complete execution path.

## Implementation

Source `386641ab4dbb0642547e96c06bf1337f642170d4`, corrected by
`376aa09dbd6b77dfda594220417ebfc3926be4a9`; integration
`5117e209bb64b7ae6edf2f984e0d3c52a4c3fca3`.
Contract: [Journal transactions](../design/lld/output-source-journal.md).

Six private methods persist/read collection intents and verified sources, release
from an exact stored receipt, or close a genuinely failed original collection.
They share existing queue, timeout, shutdown and two large-original credits.
Requests are byte-bounded before cloning/parsing; native SQL CASE bounds stored
payloads before materialization. Replies are owned and checked; commit receipts
must match the parent's prepared request.

Migration012 atomically adds immutable records and two quota charges, preserving
historical migration definitions. All six quota terms remain charged through ACK,
pruning and execution release. Original scope, physical Journal UUID, installed
identity, runtime spec, launch, checkpoint, result and disk hold must agree.
First failed closure requires the per-open epoch; exact terminal failure replay
remains available after reopen. Epoch equality cannot prove controller lifetime.

## Recorded checks and review

The initial source group passed50 cases and failed10, real14.76s. Correcting only
the failed migration/ambiguity fixtures yielded36 passes across those two files,
real7.57s. Two affected existing checkpoint/disk quota files passed11 cases,
real4.18s. Earlier passing transaction/quota/wire evidence was reused.
Affected Node types passed, real6.35s; changed-file lint passed, real0.71s, with
later changed-file lint real0.95s. Initial failures and fixes remain in task reports.

Independent review took4m13s and found native lifecycle constants and chronology
missing from SQL guards. Corrections add direct native insertion/update oracles,
rehashed invalid sources, exact unchanged row/charge/FK checks and valid controls.
The correction's first run passed46 cases; one oracle reached an earlier key-order
guard and required a serialization-preserving fixture correction. Its isolated
rerun passed, real1.54s. Six additional malformed collection-time cases plus two
valid controls passed, real2.39s; final two-file lint passed, real0.58s.
Independent finding closure took approximately34s without repeating checks.
These are composed scoped results, not a claim that all tests reran on the final
correction. One native SQLite probe independently demonstrated the text timestamp
comparison that motivated the explicit integer gate.

On integration `5117e209`, the affected Node typecheck passed, real8.05s, and the
structural gate passed1271 source files, real2.64s. No behavior tests were repeated.

## Limits

Tests use synthetic stopped/root metadata with real SQLite and compiled workers.
Actual withheld post-COMMIT replies, caller cancellation and same-file/UUID reopen
exercise ambiguity and exact accounting. Native mutation/read tests exercise live
guards and byte bounds; deliberately corrupted copies separately test read refusal.
They do not prove filesystem quiescence, original controller lifetime, native k6
execution, application publication, Linux architecture support or release readiness.

Source-first installation recovery is integrated from source `cf931a7` in
`fd50875`. Coordinator review checked the three owned paths, runtime ordering and
actual compiled-worker reply-loss/reopen tests. Its16 focused tests passed,
real5.49s; lint passed, real0.61s; Node types passed, real5.89s, after a test-only
concrete-controller setup correction. The tests use synthetic root metadata;
they prove durable recovery ordering, not native file custody. These exact-source
checks were reused at integration without rerunning them. Coordinator review
elapsed time was not separately measured.

Controller intent/source/recovery wiring and historical current-schema fixtures
remain follow-ups. No full-suite or container build was repeated for these packets.
