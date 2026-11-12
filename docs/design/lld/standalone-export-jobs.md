# Independent standalone export jobs

Status: assignment/result contract first; full admitted lifecycle remains required.
Owners: shared protocol for immutable values/integrity, engine for compiler/build,
agent for physical admission/lifetime, metadata for durable intent/artifact publication.
This extends [engine export](standalone-export.md), not a backend-local build path.

## End-to-end behavior

Generate from an immutable suite revision and exact published input pins without
running a test. A later workspace-scoped POST /suite-revisions/:revisionId/exports
submits requestId, script timeout, resource policy and explicit build budgets.
The proposed /runs/:id/exports route may resolve that Run's revision through the
same use case; it must not introduce a second compiler or lifecycle.
Shared request receipts provide exact logical replay before current eligibility.
Capture revision/config digest, inputs, installed image/descriptor and settings
versions in one transaction; pin inputs until exact producer/publication retirement.
Do not enqueue before a profile advertises the dedicated export capability.

Queued -> dispatching -> generating -> publishing -> ready describes generation.
Known failure/cancellation uses failed/cancelled; ambiguous delivery/IO/stop remains
unknown and charged. No performance Run, target interaction, assertions or passed
performance verdict is synthesized. Reconcile the same original and immutable
physical authority; no new attempt on lost acknowledgements. Cancellation and
terminal release require original-work/container quiescence, not a timeout receipt.

## Assignment boundary

StandaloneExportAssignment is a closed, separately tagged version1 envelope with
purpose standalone_export, export/request UUIDs, immutable revision UUID/digest,
existing Offer and explicit scriptTimeoutMs/maximumBuildBytes, assignmentDigest.
Wrapping preserves Offer's installed identity/image, input pins, CPU/memory/PID,
whole-job timeout/output budget and execution policy without copying its schema.
This envelope is deliberately NOT an Offer: the current performance intake must
reject it until a dedicated dispatcher/capability is implemented.

Require k6/configVersion1 and standalone-export-v1 in requiredCapabilities. This
purpose requires an explicit secretReferences array; refuse nonempty declarations
before hashing/admission. The actual compiler/helper must also
refuse compiled secret declarations; the shared contract never interprets config
or resolves environment/files. The immutable revision/config/pin relationship is
proved by the metadata transaction and staged input owner, not by hashing a label.

Bound outer assignment to existing Offer allowance+8KiB; separately revalidate the
nested Offer, its original byte allowance and config byte limit. Preserve the
exact config data. Hash every assignment field except assignmentDigest under
beetle-lab.standalone-export-assignment.v1 plus newline and canonical JSON.
A different budget/source/identity/options produces a different assignment.
The digest is content integrity, never admission or authentication proof.

maximumBuildBytes is1..64MiB and includes simultaneous compiler plan/entry/script
scratch through the existing builder. Reserve another8KiB result and64KiB control
inside Offer.outputBytes; no capacity is invented. Whole-job timeout bounds this
build task. scriptTimeoutMs is separately1..172,800,000ms, matching the existing
standalone runtime validator; it limits the downloaded test when run externally.

## Result boundary

StandaloneExportResult is <=8KiB, version1/purpose standalone_export, exact
export/attempt/workspace/organisation/generation1 and assignmentDigest. Status is
succeeded, failed or cancelled. Succeeded requires reason:null, exactly one
standalone-k6-script artifact at standalone/suite.js and known buildUsage(bytes,
peakBytes). Failure/cancellation has artifact:null and a fixed typed reason; usage
is known or null. Unknown native work produces no invented terminal result.

Use the shared artifact descriptor and result-seal structure. A separate prefix
beetle-lab.standalone-export-result.v1 plus newline prevents cross-purpose reuse.
Sealed time and every identity/usage/descriptor are covered; only the SHA self-field
is excluded. Reuse one bounded seal implementation while preserving engine-result
v1 golden bytes and public functions. Hashing authenticates no producer.

Bounded semantic capture verifies the seal, matches the entire assignment identity,
and requires build bytes<=peak<=maximumBuildBytes. Success artifact bytes equal
build bytes, stay within allowance, and artifact time does not exceed result seal
time. Require finite parsed times before ordering; structurally admitted RFC3339
leap seconds never bypass that semantic check. No metric/outcome interpretation, raw diagnostics, partial artifact or path
from the browser is accepted. Only verified native custody may publish the file;
a descriptor or result hash is not proof of physical publication/release.

## Integration and acceptance

Next implement one engine-owned operation using the existing compiler/builder,
retaining original build/hash/close work through cancellation and exposing no
success after close/deadline. It runs only inside the separately admitted container.
Then wire durable intent/replay/cancel/reconciliation, explicit runner purpose,
verified source/artifact publication, scoped HTTP/download/UI and container client.
No HTTP route or runnable capability is advertised by the contract component alone.

Prove generated types/schema closure, old Offer/EngineResult rejection, exact
assignment binding and budgets, config/outer limits, secret refusal before effects,
closed states/fields, provider failure and domain-separated golden preimages.
Test altered source/scope/generation/options/usage/descriptor/time and immutable
snapshots/accessors. Existing engine-result golden vectors must remain unchanged.
Actual admitted container, native export execution and public workflow remain
required before F15 is marked complete.
