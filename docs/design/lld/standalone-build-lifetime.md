# Standalone build lifetime

Status: engine component; admitted export orchestration remains required.
Owner: engines/k6/export. Reuses exportStandaloneScript and the one compiler/builder.
Trusted frozen compiler output remains a precondition, not a foreign-JS sandbox.
This component proves no revision/assignment relationship; the staged input owner
and future export coordinator must establish that binding before invoking it.

startStandaloneBuild adds a caller-owned AbortSignal and fixed performance.now
monotonic deadline to existing standalone input. Capture scalar build options and
context before async work. Script timeout still controls the downloaded test;
this deadline controls the build call. Reject invalid profiles before file effects.
A deadline may be at most172,800,000ms away, matching the existing runtime bound.

One original existing helper call, one timer and one abort listener, no waiting
queue/retry. Check monotonic validity/rollback, signal, close and deadline before
invocation and after the original returns. A late success cannot pass merely
because the timeout callback has not run. Timers use actual remaining time.
Close/cancel/deadline is sticky; close before invocation starts no build work.

Result may reject promptly while the opaque builder is still running. settled
retains the original helper call, including its finally work; close waits for it.
An original builder failure is explicit on settlement, even after logical timeout.
The helper has no abort port: do not pretend the underlying build was preempted,
delete its partial output, release its container or refund its disk reservation.
No API-promise settlement proves all native descriptors/child processes are gone;
parent still needs physical container stop, native custody and publication proofs.

Stop/failure diagnostics are fixed codes with no exception/config/path text.
Remove timer/listener after logical result; never leave a background poller.
Parent must recheck its own admitted fence before later script/result publication,
including a stop between this result and that continuation. Its original job
budget remains authoritative across compile/build/hash/seal phases.

Acceptance: actual compiler/build/native script custody, captured scalar mutation,
held original cancel/close, original late failure, no-start closed/aborted/deadline,
post-return deadline without timer callback, clock rollback and secret/error bounds.
No load engine, Docker capability, scheduler, public API or complete F15 claim.
