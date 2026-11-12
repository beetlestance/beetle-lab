# Native output close-failure custody

Status: reviewed local prerequisite correction for producer retirement/cleanup.
Base43f9bb4; source is the commit containing this report.
Contract: [collected output lifetime](../design/lld/output-collection-custody.md).

## Correction

The native collection/range lifetime already cached rejected original descriptor
closes and withheld successful results. It nevertheless returned its admission slot
after a rejected close. The counter also retained no strong reference to that failed
owner. Repeated failed cleanup could therefore admit further native work.

Collection and range now each use one bounded set of at most two strong owners.
Successful original descriptor cleanup removes the owner; rejected original close
retains its owner and slot until process exit. Independent handles still close.
The same close promise remains rejected and is never retried. Settlement through
quiesced does not become proof of successful descriptor cleanup or file absence.
Errors/cancellation with successful cleanup still release their slots normally.

## Evidence

A new real-file/native-fault regression produced two failed original closes in each
lane, then attempted a third operation with forbidden capture callbacks. On the
old source both tests failed: the third operation entered capture and returned
invalid_options instead of the required pre-capture busy refusal.

On corrected source, 196 collection/range/transfer cases across14 files passed in
23.93s. They retain saturation before capture, original close identity/rejection,
independent descriptor cleanup, pending native work through stop/deadline, normal
success after good cleanup, final metadata checks and transfer byte/custody checks.
Four pre-existing close-failure cases were moved unchanged into separate files:
permanently occupied native slots must not share a process with later success cases.
No static admission reset, assertion weakening or gate exception was introduced.

The authenticated native source-transfer loopback integration also passed, using
task-owned files/ports and the compiled Journal worker. Node types, changed lint,
architecture/docs and the agent source build passed. The independent review found
no blocking defects; the reviewer did not repeat these checks.

## Limits

The fault seam makes original descriptor-close outcome unknown; this is local
native/worker evidence, not Docker, architecture-matrix or OS fault qualification.
No schema, migration, transport or public API changed. This correction introduces
no cleanup acknowledgement, unlink, retained-disk refund or producer-retirement
permission. Failed native custody still requires conservative recovery; no real
user files or running services were changed.
