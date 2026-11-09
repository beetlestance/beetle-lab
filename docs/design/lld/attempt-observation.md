# Backend attempt observation merge

Status: pure boundary implemented; SQL delivery/finalization pending.
Owner: app/domain/runs. [Execution](execution-protocol.md) owns agent event facts;
[admission evidence](agent-admission-evidence.md) owns independent admission facts.

## Input and output

mergeAttemptObservation({expected,previous,incoming}) returns a deeply frozen
{snapshot,runState}. expected is the original attempt/scope/digest identity and
generation1; previous is the last accepted remote snapshot or null. Both snapshots
are captured with the shared bounded serializer (<=73728 UTF8 bytes, existing
node/depth/collection caps) and schema checked before use. Identity copies <=1024
bytes. The closed three-field input envelope is captured first (<=148608 bytes
and the shared node/depth/collection caps). Accessors/non-JSON data fail without
invocation, including on the envelope. No I/O, clock or retry.

Match exact attempt/organisation/workspace/intent strings and generation1, including
nested result attempt/scope/generation. The initial release never advances to an
arbitrary larger generation. Validate retainedStartSeq <= lastSeq+1 without unsafe
addition. Shape validity alone does not establish either semantic relation.

## Sequence-owned projection

State, phase, result and first public exitEvidence are atomic with agent lastSeq.
At equal lastSeq require canonical equality including optional-field presence.
A difference is conflicting evidence, not a tie resolved by receipt time.

For unequal sequences validate forward consistency from the earlier to the later
snapshot, regardless of reply arrival order. Once present, result and public exit
are canonically immutable and cannot disappear. Phase cannot disappear or rewind.
Offered cannot follow another state; admitted cannot follow an execution/stop state.
Stopping can remain stopping or become lost/exited; lost can remain lost or become
exited; exited stays exited. Later wrapper phase/result enrichment is allowed after
terminal state. Do not numerically rank active states: actual runtime.started with
no phase followed by validate evidence legitimately changes running to preparing.
The greater-sequence projection wins; an older reply cannot add a witness that was
missing from the retained higher-sequence projection.

## Independent facts

Cancellation merges with OR. Retained-start cursor merges with max. Neither changes
which event projection wins or grants ownership of actual event bytes.
Admission facts use their owning partial order: missing/earlier evidence cannot
erase known facts; final reason/disposition conflicts and incomparable branches fail
closed. This merge applies even when the enclosing snapshot has an older lastSeq.
A final admission fact may arrive without its intermediate observations.

## Application projection

Return finalizing for lost/exited or matched final rejected/released admission facts.
Otherwise offered maps to dispatching and admitted/preparing/running/stopping/
collecting to active. This is eligibility for further reconciliation/finalization,
never a terminal result, passed validation, event ACK or capacity-release mutation.
Resource release requires its separate durable transaction; settled release alone
does not prove complete result/artifact evidence. Run.version increments only when
the future transaction changes the public Run DTO, not every remote cursor change.
Existing current run cancellation remains separately durable and must not be erased.

Invalid input/conflicts throw the existing static invalid_value semantic error;
no IDs, raw values or private exception messages escape. Inputs remain unchanged;
all retained output is private copied data and deeply frozen.

## Acceptance

Known source oracles: same-sequence cancel/prune/admission change; strict equality
of optional witness presence; reversed replies; legitimate running -> preparing;
sticky stop/lost/exit; late immutable result enrichment; unchanged public exit with
unknown fields; wrong outer/nested identity/generation; safe cursor upper bound;
admission conflict in both directions; missing evidence never releasing anything;
input/output mutation isolation; accessors and oversized envelopes refused.
These pure tests do not prove SQLite atomicity, HTTP ownership, execution, release,
event completeness, finalization or native resource behavior.
