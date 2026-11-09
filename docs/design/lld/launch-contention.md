# Launch intent under bounded journal reads

Status: implementation contract. Known gaps at source9caa151 are described in
[storage intake evidence](../../verification/storage-intake.md); not yet qualified.
Owner seams: controller/supervisor private types, installation drive and their tests.
Read [Offer bounds](runner-envelopes.md) for original-work credit ownership.

## Known refusal versus uncertainty

Only concrete JournalError(queue_full) from a readOffer call rejected before issue
is a journal-busy deferral. It is not a journal failure or a failed test. Preserve
caller budget/deadline checks after the refusal. Unavailable/unknown commit, failed
binding, backend errors, ambiguous create/start and cancellation keep their existing
fences; never reset their launch-attempted marker or retry their side effects.

AttemptProgress adds `{kind:'deferred',reason:'journal_busy'}`. SupervisorError adds
`journal_busy`, emitted only for this read boundary. Use a private sentinel inside
the actor to distinguish this provenance from unrelated errors. No public runner
JSON schema changes, timers, waiter queues or active-engine concurrency reduction.

The existing AttemptController owner retains one Boolean pending explicit launch.
An accepted launch() sets it before foreign work; tick-only/recovered controllers
start without it. A known refusal before actor dispatch returns deferred before
control/collection work and retains the Boolean. A later tick may service that
same intent. Successful/nondeferral actor settlement or ambiguous failure consumes
it; cancel/close fence it. Rejected concurrent/closed calls cannot create new intent.
This is completion of the original request, not an execution retry.

LaunchActor preserves its PRIOR launchAttempted value on this one pre-issue read
refusal, allowing the original explicit request to resume. It never blindly resets
to false: an earlier unknown launch remains retired. Every other failure retains
the existing permanent retirement behavior. ClaimCreate/claimStart and backend
originals are never replayed by this exception. Check durable cancellation and
original admitted timeout again before resumed create/start, with no extension.

## Compact immutable authority

Never replace original Offer authority with independently mirrored reservation or
plan fields. First read must retain the existing Offer/Reservation/Plan validation.
After that success, cache only scope, intentDigest, engine and the five budget
fields from the immutable accepted Offer, with frozen nested engine/budget objects.
Fresh reservations are still read and checked each step against that authority.
Preserve generation/status/aborted/specDigest, plan labels/image and CPU/RAM/PID
binding checks. Accepted Offer immutability belongs to the sole journal writer;
no public update exists. This cache does not certify arbitrary administrator edits.

Controller collection retains only engine.id and budget.outputBytes from its first
successful Offer read; no full config or secret references remain in owner state.
Actor caches only the validated compact authority. Neither rereads full config on
ordinary ticks. Installation drive reuses its already-owned staged plan for later
ticks; a full Offer remains necessary only while admission/staging/recovery needs it.
Do not add a duplicate full-Offer cache or skip fresh reservation/stop checks.

## Ownership and verification

Controller and actor keep their existing single-flight owners, cancellation drains,
phase/control/output ownership and bounds. A refusal cannot restage input, drop a
plan/watch, uncharge an attempt or advance control cursors. Pending intent is one
bounded flag within the existing64-owner ceiling, not a retained caller object.
Crash/restart does not create a new implicit launch intent for recovered owners.

Tests must hold two actual Journal large requests at EACH initial controller and
actor read. Assert a known deferred result, unchanged charged identity/plan and no
target read/claim/backend/control/provider original. Free credit and tick: exactly
one create/start, with no restaging or duplicate engine effects. Repeat refusal.
Exercise tick-only/recovered owners, cancel/close/deadline during deferral, prior
unknown outcomes, binding corruption and original cleanup still held. None may gain
a launch from the new flag. An unavailable read is not a busy deferral.

Count reads over repeated ordinary ticks: no full-config rereads after authority
capture/owned plan. Corrupt fresh reservations must still reject every existing
scope/intent/image/budget/plan mismatch. More than two admitted engines may progress;
native stress, stop latency and measured overhead remain separate qualification.
