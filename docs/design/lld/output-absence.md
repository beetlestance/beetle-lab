# Source-free execution closure

Status: integrated; native rejection and an affected real-k6 control are
[locally verified](../../verification/output-absence.md). Complements
[source settlement](output-finalization.md); it never manufactures a source receipt.
Journal migration014 and application migration012 implement the storage contract.

## Wire and ownership

`OutputAbsence` is runner JSON Schema: version1, exact org/workspace/attempt/
generation1, intent digest, physical Journal UUID, finalAgentSeq, definitive
AttemptAdmission (rejected or released), and typed failure reason. The shared
capture function admits at most2048 UTF-8 bytes and preserves exact physical UUID.
The value grants no authority merely by passing schema validation.

Trusted Journal methods closeOutputAbsence/readOutputAbsence take only Scope.
Close runs after the existing Manager native retirement barrier and derives every
fact and stream end from stored owners. Caller supplies no sequence, reason,
EngineResult, SourceReceipt or quiescence flag. Return null if not definitively
eligible; corrupt/mismatched evidence fails. Equal committed replay is immutable.

Authenticated GET /runner/v1/attempts/{attemptId}/source/absence returns the proof
only after durable closure. Before that, known originals return409 source_pending
with retry transport. The ordinary source GET returns409 source_absent/retry never
only when this exact durable closure exists. That marker authorizes fetching the
proof, never credit or terminal projection. Other errors/404s do not imply absence.
The getter shares the existing installation source credits/native I/O owner, caps
its body2048 before native materialization and verifies all original binding fields.

## Agent eligibility and retirement

Eligible cases derive from existing authoritative owners:

- Rejected: validated durable admission/fresh-refusal fact and no reservation.
- Never started: requireUnstarted/abortUnstarted facts, no create/start token or
  runtime ID, aborted/launchClosed reservation released.
- Settled without source: requireSettledRelease with definitive launch settlement
  and matching stopped runtime/failed collection evidence. A current failed
  collection is not an unresolved pending publication.

No committed source or source-delivery closure may exist. A recovered pending
collection intent cannot be relabelled failed; recover original publication or
retain it for reconciliation. Unknown launch/release, a timeout, exited snapshot,
local installed_identity progress, restart or an empty new Manager are insufficient.

Reuse retireNative/drainNative: public leases except the calling drive, preparation
result/quiescence, watch/timeout closes, final cancellation chain and controller
close. Sticky failures keep ownership. Preserve supervisor evidence/cancellation
lanes. Only after this barrier can the trusted Journal close be called; SQL itself
cannot establish native quiescence. No entry is removed while required closure is
uncommitted. Cold recovery must establish the actual native ownership/barrier.

Persist bounded indexed absence debt when definitive rejection/release arises;
clear it only with closure. Extend existing scheduler fairness/slots, without a
new pool or repeated history scan. Migration can mark debt with a bounded4097-row
preflight under the existing4096 retained ceiling; it backfills no closure authority.

Migration014 adds a separate immutable closure and explicit absence-byte charge
(proof canonical bytes+256). Preserve existing source counters and013 definitions.
Update current quota guards to include that charge. Native guards protect duplicate
INSERT/REPLACE/UPDATE/DELETE, match physical scope/admission, enforce source mutual
exclusion and freeze event end/high-waters/result/checkpoint/terminal evidence.
Reject new launch/admission/collection/source work after closure. Exact duplicate
replay, ACK/pruning and non-event cancellation remain allowed. Closure reads verify
the same final end even after pruning. Agent disk holds are not refunded/deleted.

## Diagnostics and outcomes

`OUTPUT_REJECTION_REASONS` is the single mapping for rejection reasons, reused by
Journal projection and native SQL guard generation: cancellation -> cancelled;
staging_policy -> setup_failed; unsupported/unapproved/controls_unavailable ->
unsupported_capability; minimum/ceiling/impossible request -> budget_unavailable.
Never-started uses its durable stop reason, otherwise setup_failed. Failed
collection uses a durable typed stop/exit reason, otherwise artifact_incomplete.
Unknown diagnostics cannot upgrade unknown physical ownership into eligibility.

Backend outcomes are cancelled or errored/inconclusive, never finished/passed.
Persisted Run cancellation wins at commit. Without that intent, a proof whose sole
reason is cancelled remains pending execution until the matching observation/
intent is reconciled. Validation remains pending; no provisional result grants
source-backed validation or outcome authority in this path.

## Backend custody and finalization

Metadata.absences implements read/adopt/finalize from ports/output-absence.ts;
all requests/replies<=4096 on the existing ordinary lane. Adopt binds the exact
acknowledged physical original, stores one canonical proof and SHA-256 digest,
and is idempotent. Missing source and a verified absence are different states.
No adopted source, manifest carrier or artifact slots may exist. Normal transfer
creates files only after source adoption; partial source-backed custody can never
fall back to this path. A provisional kind=result carrier remains retained.

Finalization is one immediate transaction. Matching committed receipt replay
precedes stale expectedRunVersion rejection. Otherwise require current scoped
active attempt/version, definitive snapshot admission matching proof and released
execution charge. Header.lastSeq must equal finalAgentSeq: unlike a source-backed
manifest, this proof does not carry the final result. Every accepted result updates
the Journal projection and sequence atomically; an older header cannot establish
the retained result bytes. Require contiguous
unblocked events/count/durable/full confirmed ACK exactly at that end, with no
event above it. Seed an exact zero cursor if needed before closing discovery.

Retained payload is C+R: immutable charged event bytes plus actual canonical
provisional-result bytes (or zero). Credit P-(C+R) once, retaining C+R+65536. Do
not hide result bytes in metadata, mutate original allocation or delete files.
Migration012 adds sibling proof/receipt tables with scoped original/allocation FKs;
preserve011's source FK, without rebuilding cyclic tables. Proofs and both receipt
families mutually exclude each other. Native receipt insertion validates derived
facts and atomically credits the same admission counter, projects Run and closes
event_pending. No global accounting SUM/reconstruction on each finalization.
Fence later source/payload/slot/event/snapshot changes and reopening obligations;
late full-ACK confirmation may point-read either exact receipt without writes.

## Runtime sequence and acceptance

An exact source_absent marker becomes a distinct transfer error; the producer and
native originals must retire first. Runtime fetches/captures the proof on the same
connection, adopts it, then finalizes using current scoped Run version. Retained
proof read avoids a remote refetch after reopen. Missing required capability fails
explicitly; no synthetic proof or successful partial owner. Production startup
wires the real absence store/client and dispatch observation capability before
capacity startup awaits. Retained proof reads occur only inside the settled
source-absent handoff, preserving source-present mutual exclusion.

Ordinary snapshot polling ends when execution charge is released. If finalization
finds an older header, the retained output owner must fetch the full bound attempt
snapshot through the existing runner client and apply existing dispatch.observe
before retrying finalization. Use the same original-call credits and physical
binding; do not re-offer, infer a snapshot from events or create another poller.
Equal-sequence conflicting projections fail. A header beyond the proof end fails.

Required proof: compiled Journal and Metadata workers, retirement held originals,
lost commit replies/reopen, source/absence races and native bypass/REPLACE/late
append, cancellation orders, zero/end/gap/ACK debt, older/beyond-end headers, wrong physical
UUID/scope, retained provisional result and exact/short quotas. Reject uncertain
publication/failed native close/unknown launch/adopted-source fallback. No engine
execution retry, deletion or agent storage refund is introduced by this contract.
