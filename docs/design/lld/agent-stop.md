# Durable attempt stop reason

Status: implemented and independently reviewed component;
[local evidence](../../verification/durable-stop.md). Output guard and runtime qualification remain.

The private supervision transaction owns the first durable stop time and reason.
Reasons are cancelled, timeout, output_limit, artifact_incomplete or clock_integrity.
A command with cancel:true may name its reason; omission means user cancellation.
A reason without cancel:true is invalid. First persisted intent wins across repeats,
racing callers and restart; later user cancellation cannot relabel a storage failure.
Urgency is separate: a sticky immediate-stop flag allows a later guard violation
to escalate an earlier graceful user cancellation without changing attribution.
Cached cancellation/write lanes retain and persist that one bounded escalation.

The existing cancelRequested flag fences all termination requests, including system
stops. It means stop requested, not proof of user cancellation. Public runner cancel
still supplies only user cancellation. Internal InstallationController.stop accepts
output_limit, artifact_incomplete, timeout or clock_integrity and is never exposed through runner HTTP.
Attempt control-intake/checkpoint failures request artifact_incomplete; their
fail-closed termination is a system failure rather than user cancellation.

Migration007 adds nullable cancel_reason and a monotonic stop_immediate flag. Existing rows
are preserved without inventing a cause. Previously cancelled rows without a cause
are clock-fenced on observation; they cannot acquire a fresh grace period. No queue,
reservation, launch claim, result or artifact is deleted or released by this change.

Actors recover the durable cause before dispatch and termination. Timeout and clock
stops persist their actual cause rather than defaulting to user cancellation.
User cancellation and timeout retain the original bounded graceful-stop policy;
output control or incomplete-output inspection requests immediate kill. Clock
integrity still forces emergency kill. Original create/start work must resolve
before signalling; uncertain work remains owned and charged as before.

runtime.exited reports output_limit/artifact_incomplete through existing reason
codes, distinct from cancelled. OOM evidence retains memory_limit precedence.
The cancellation.requested control event records generic termination intent; it
does not classify the run as user cancelled. Final application outcome must use
verified result, runtime evidence and durable stop cause, never that event alone.

This transaction proves intent, not stop success, irreversibly retired remote
dispatch, artifact custody, application finalization or safe capacity release.
Output/free-space scanning, guard freshness and measured stop latency are separate
requirements. Acceptance covers first-reason races/restart, unknown historical
cause, scope/generation validation, create/start fencing, immediate system-stop
signalling and user/timeout grace preservation.
