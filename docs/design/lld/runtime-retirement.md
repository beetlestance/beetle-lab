# Exact retired-runtime authority

Status: C3a implemented locally; native file inventory/removal remains separate.
Parents: [producer retirement](producer-retirement.md),
[output retirement](output-retirement.md) and [namespace](staging-namespace.md).

## Authority chain

The private RuntimeRetirement owner accepts a genuine process-local C2c producer
barrier from the same physical Journal retirement port. It matches the verified
installed namespace, rereads the immutable retirement intent and current Journal
eligibility, and requires the exact released reservation. Eligibility owns closure,
application ACK, task snapshot and reserved-control validation. Caller metadata,
a stopped observation or an HTTP404 alone grants no removal permission.

Recover the original plan through the installation's existing compiler/catalogue
path. Missing catalogue/spec/identity remains unresolved. Bind the original full
runtime ID before any container observation. Every attempt freshly qualifies the
verified installed daemon. Inspect by original ID and validate the complete plan;
a same-name replacement, renamed original, running/paused/restarting/unknown state
or changed daemon refuses deletion. Delete only the exact original ID, with
force=false and v=false; confirm original-ID and task-name absence afterward.
A never-started branch instead requires positive released/aborted facts with no
create token/runtime ID, the genuine producer barrier and fresh daemon qualification.
It issues no Docker mutation.

## Mailbox association and recovery

Ordinary runtime removal keeps its existing API and ownership rules. The separate
retired path does not fabricate local creation/removal history to enter that API.
A matched original container can establish the mailbox association through existing
volume verification. After original removal, the same retained backend may reconcile
an uncertain delete and remove that verified mailbox non-force, confirming absence.
A cold missing original plus an existing volume without a durable association remains
unresolved: matching names, labels and options cannot reconstruct prior custody. Missing original and
missing mailbox can establish absence only with the full positive authority chain.
The [Journal association](runtime-association.md) now persists exact observed custody
before deletion and restores it across cold recovery. Native checks still establish
current absence; full C4 composition and public cleanup remain separately qualified.

## Lifetime, bounds and result

One owner per physical Journal, at most64 scoped retained attempts. Reserve before
foreign work. Capture a fixed operation deadline (maximum30seconds) and native abort
signal before awaiting; recheck owner, producer capability and budget after reads
and before subsequent effects. Concurrent exact requests share the original promise;
conflicting requests refuse. Issued requests remain owned through their actual promise
settlement. Failed backends retain their association and occupy a slot for retry.
Shutdown fences new calls, aborts as a hint and awaits original attempt promises.
Unknown/failed retained custody makes close unresolved; it never frees capacity by timer.

Success mints a WeakMap-authenticated local RuntimeAbsent capability bound to the
exact intent, daemon and runtime ID/spec (or positive never-started fact). Both this
owner and its producer owner must remain open; a different Journal cannot use it.
The capability proves removed-writer authority only. It asserts no physical socket
close, native file absence, durable cleanup receipt, backend ACK or quota refund.
Ordinary Docker JSON response completion is not promoted to transport quiescence.
Native file cleanup must separately acquire and drain its actual descriptors/credits.

## Acceptance

Exact-ID deletion; full-spec same-name replacement/renamed original refusal; wrong
daemon and malformed binding before effects; unsafe states; genuine/cross-Journal
capabilities; operation snapshot/deadline/close races;64-entry bound; unknown-delete
reconciliation; retained versus cold mailbox association; private bootstrap composition.
Real Docker evidence must name its leaf/composed scope explicitly. Full C3–C6 and
public automatic cleanup remain pending.

Cold recovery now uses [runtime association](runtime-association.md): exact stopped
runtime/volume observation commits before container deletion; live checks remain required.
