# Agent admission evidence

Status: wire and journal/HTTP projection implemented; application consumption pending.
Owner: agent journal for admission facts; backend dispatch for logical charges.
[Execution](execution-protocol.md) owns lifecycle/events; [run intake](run-intake.md)
owns the immutable original Offer. No application dispatch implementation is implied.

## Why a separate fact

Agent events sequence state/phase/result/first public exit evidence. Queue rejection,
reservation release, cancellation and pruning can change without a new event.
An offered snapshot alone cannot distinguish a waiting job from a final refusal;
exited/lost alone cannot prove launch and collection originals have quiesced.

AttemptSnapshot.admission is the generated AttemptAdmission tagged union:

| state | Meaning |
| --- | --- |
| queued | An owned admission queue record is pending; no reservation exists |
| charged | The exact generation has an active durable reservation |
| rejected | Queue is closed with the recorded final reject reason; no reservation exists |
| released | The exact reservation is irreversibly released by its existing authority |

The field is absent when the journal has no tracked admission facts, for example a
direct journal Offer without installed admission. Absence supplies no authority.
Installed snapshot/Offer/cancel replies must project actual available admission
facts from the same original journal command; do not fill defaults or derive them
from public lifecycle state. No extra endpoint, polling source or event cursor.
All facts bind the outer attempt, scope, intent and generation. Contradictory,
malformed or oversized stored facts fail the read; never fabricate unknown/success.

Rejected reasons are a closed enumeration of the existing durable admission policy
rejections. Defer reasons are not final refusals. Once rejected, the exact accepted
Offer replay cannot enqueue or admit it anew. Cancellation of a pending queue is a
final rejection; cancellation of a charged reservation remains charged until release.

## Release authority

Released disposition never_started requires the existing abortUnstarted authority:
no create token, start token or runtime ID, aborted=true and launchClosed=true.
No runtime creation capability may have escaped. Released disposition settled
requires the existing definitive launch settlement plus matching later runtime
stopped/absent and collection finished/failed evidence accepted by releaseSettled.
Unknown settlement, outstanding originals, terminal event, snapshot state, timeout,
404 or cancellation is insufficient. Projection must reuse the reservation owner's
release invariants; it must not invent a weaker second release path.

The journal validates bounded stored reservation/queue data before projecting a
compact fact. No runtime ID, dispatch token, filesystem path, private proof payload
or resolved secret enters this field. Released reservations cannot be recharged;
accepted replay keeps the same original Offer and final admission disposition.

## Backend merge and accounting

Admission facts are independent of lastSeq. Merge this partial order for matching
identity: absent -> queued -> charged -> released, or queued -> rejected. A missing
or earlier fact cannot erase a known one. Every incomparable pair fails closed,
including charged/rejected and rejected/released, as does conflicting final
reason/disposition. Equal facts are idempotent.
Receiving a final fact first is allowed; intermediate snapshots may have been lost.
Canonical equality of the sequence-owned fields is still required at equal lastSeq.

Only matched rejected or released evidence can release a retained logical execution
charge through a dedicated backend transaction. Persist that fact with release;
unknown/restart retains charge. Historical cost stays immutable. Release concerns
execution admission, not retained artifact/storage quotas, result completeness or
permission to delete evidence. A snapshot's lastSeq never authorizes event ACK.

Non-execution rejection/never_started may support a separate finalization decision
without a result seal because they prove no engine launched. They never mean pass.
Settled release alone cannot complete a run; normal result/exit/artifact proof is
still required. Finalization must select a typed cancellation/setup/refusal outcome.
Those application transactions remain separately frozen before implementation.

## Acceptance

Prove actual journal queued -> rejected without sequence advance, same Offer replay
and reopen retaining rejection, cancellation before and after reservation, and
charged -> never_started/settled release under existing launch/collection guards.
Reject release with unknown settlement or outstanding originals. Preserve pending
charge for offered/exited/lost alone. Exercise actual installed HTTP snapshots,
private payload redaction, wrong scope/generation, oversized/corrupt stored facts,
reversed independent admission facts and unchanged event ACK ownership.
Schema conformance alone does not establish any of those runtime guarantees.
