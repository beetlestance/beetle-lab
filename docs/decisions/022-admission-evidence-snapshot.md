# Decision 022: Admission evidence is a separate snapshot fact

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

`AttemptSnapshot.admission` carries the agent journal's admission state
(`queued`, `charged`, `rejected`, `released`) as a fact independent of the event
sequence. The backend merges it by its own partial order, regardless of `lastSeq`,
and releases a logical execution charge only on matched `rejected` or `released`.

## Why

Queue rejection, reservation release, cancellation and pruning change without a
new agent event. An `offered` snapshot cannot tell a waiting job from a final
refusal, and `exited` or `lost` cannot prove that launch and collection originals
have quiesced. The backend needs a fact it can trust before giving capacity back.

## Alternatives

- Derive admission from lifecycle state or events: rejected. A refusal emits no
  event, and terminal state does not prove quiescence, so charges would either
  leak or be released too early.
- Add admission events to the sequence: rejected. Pruning and refusal happen
  outside the event stream, and sequence ordering would let an older higher-sequence
  snapshot hide a later release.
- A separate admission endpoint or polling source: rejected. It adds a second
  read that can disagree with the snapshot taken in the same journal command.

## Consequences

Absence of the field grants nothing. Incomparable facts fail closed. Release is
about execution admission only; output allocation, event custody and result
completeness keep their own owners.
