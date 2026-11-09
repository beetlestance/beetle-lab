# Delivery authority and supported recovery

Status: journal/control-store and actual startup verified; runner wire under verification; backend/restore work pending.
[Local foundation evidence](../../verification/authority-foundations.md).
Owner: coordinator for the runner contract and migrations; agent journal for
physical delivery authority; application dispatch for the immutable binding.
[Dispatch storage](dispatch-storage.md) retains charge and original identity.
[Installed runtime](agent-runtime.md) owns execution startup and shutdown.

## Failure to distinguish

A backend claim commits before network issue. A missing agent receipt can mean
that the original PUT never arrived, or that receipt history was reset/restored.
Logical installation identity, Docker daemon identity and generation1 do not
prove journal continuity. A404 alone never permits release, replacement or retry
under a different original. The current component cannot make this distinction.

## Authority

Persist one random UUID when a new empty journal is initialized. Preserve it
across intact process/journal restarts. Missing/malformed authority in an existing
journal is an explicit upgrade/recovery condition, never implicit initialization.
Capabilities publish required canonical `journalAuthority` with the installed
observation. The server binds its producer to the captured opened-journal UUID. The backend
captures it from the same validated source frame used for the first claim.

Persist the authority atomically with first possible delivery, before PUT. This
binding is immutable for that attempt. Later capacity/profile changes cannot
rebind an original. Existing possibly delivered rows without a binding remain
charged and require recovery; they cannot acquire the current authority by lookup.
Unclaimed rows do not yet have physical delivery authority.

Carry expected authority in a backend-owned private transport header, separate
from the immutable engine Offer, compiler input and logical generation. Validate
one canonical UUID and reject duplicate/unknown forms before intake. Agent mutation
checks must use current journal authority, with no asynchronous check/use gap
allowing an offline restore to replace the journal beneath a running owner.

A mismatched authority returns 409 `authority_mismatch`, never a missing-receipt404.
A scoped404 is specifically `attempt_not_found` with required validated attemptId.
Only the authenticated current-authority path can emit that receipt witness; generic
404/invalid protocol responses cannot authorize reoffer.
Unknown/mismatched authority retains all charges and forbids automatic reoffer or
new attempt. Normal routes reject older authorities. Supported cold restoration has no live
original to reconcile across authorities; terminal history remains readable through
application storage without granting physical release or delivery permission.

## Normal recovery and supported restoration

With intact authority, unacknowledged originals reconcile before reoffer. A retained
receipt returns the existing attempt. A matched404 can permit the same original
only when its immutable authority matches. Acknowledged404 never starts fresh work.
There is no automatic target-load retry or second attempt.

The first-release backup is cold and consistent across metadata, agent
journal, inputs and artifacts. Exclusive offline ownership must prove all Runs
terminal, no queued/possible delivery, no execution charge, no pending agent work
or create/start/collection original, and no installation-owned engine runtime.
Unknown physical effects refuse backup. Retained artifact allocations are preserved.
A bounded manifest records hashes, quiescence and image/schema identities.

Restore verifies that manifest and independently drains the current installation,
including work started after the backup. It refuses unknown ownership rather than
force-resetting or deleting execution evidence. A durable incomplete-restore gate
outside the restored paths is set before any replacement. Every startup owner
checks the gate before journal recovery, scheduler, publication and intake;
gating HTTP listen alone is insufficient. Data installation has crash-resumable
stages; a fresh authority is installed while the gate remains set.

Only terminal history is restored. Old snapshots stay historical and do not
release, ACK or reoffer work under the new authority. Clear the gate only after
restored data/authority consistency and a fresh physical-quiescence check. Every
interrupted stage stays fenced. Exact command, bounded manifest format, marker
durability and completion proof require implementation and qualification before
backup/restore is advertised as supported. Normal intact active-job restart is a
separate path and continues to preserve the original journal/authority.

A journal-local UUID cannot detect a manually substituted older same-UUID copy.
Arbitrary journal-only rewind, manual file mutation and whole-machine rollback
are outside this proposal's correctness claim. Supported backup/restore tooling
must enforce the gate and rotation; documentation alone does not implement them.
Do not present this limitation as recovery from arbitrary restored execution state.

## Control-store boundary

`agent/src/installation-state/index.ts` implements the control-store component;
RuntimeOwner consumes its lease; first-install and backup/restore commands remain pending.
`initializeInstallationState` exclusively creates an initializing record.
`resumeInstallationInitialization` is explicit recovery of that same initialization.
`openServingState` accepts only ready state; its `assertJournalAuthority` must bind
the UUID read from the opened journal before any execution owner starts.
`openRestoringState` is an offline-only facade: begin durably records an operation
and planned fresh authority; completion requires both exact identities. Its caller
must prove physical quiescence and consistent restored data before completion.
A ready serving facade exposes no mutation methods. The lease remains held until
all runtime owners drain; missing/corrupt/nonready state never becomes fresh state.

The separate control SQLite database stays outside every replaced backup path.
It uses one retained process owner and an EXCLUSIVE connection, a singleton state,
16 pages of 4096 bytes, 64KiB cache and no mmap. SQLite documents that EXCLUSIVE locks
remain until close; EXTRA adds rollback-journal commit durability. See the
[SQLite PRAGMA reference](https://www.sqlite.org/pragma.html#pragma_locking_mode).
The store verifies those settings. Native handles remain retained on failed close;
no stale lock-file deletion or process-liveness guess grants execution authority.
Hardware power-loss and actual restore-stage qualification remain required.

## Contract ownership and acceptance

Coordinator reserves the checked next unused application migration006 and agent
migration009. Runner schema generation, private
transport headers, capability publication and capacity source binding have one
coordinator owner. Do not add physical authority to the engine Offer or public Run
DTO. The backup command, bounded manifest and restore-stage contract remain required
implementation work; this design does not claim those interfaces exist.

Required fixtures before dispatch acceptance:

- Claim then crash before PUT; healthy restart and404 deliver the same original.
- Accepted PUT with lost response; restart/reconcile yields one target load stream.
- Intact receipt replay during profile drift preserves original config/identity.
- Authority mismatch, missing authority and unbound old possible delivery retain
  charge and never PUT, replace or manufacture a release proof.
- Capability refresh racing a claim cannot change the persisted binding.
- Wrong/duplicate authority header refuses before service mutation.
- Interrupted restore at every durable step prevents all startup execution.
- Cold backup refuses queued/active/unknown work and bounds manifest production.
- Restore refuses a busy/unknown destination and verifies snapshot consistency.
- Supported restore rotates authority before readiness; restored terminal snapshots
  cannot release output or execution charge, ACK or rerun an original.
- Shutdown retains original network/worker owners; abort does not prove absence.

These fixtures do not replace event custody, artifact publication or terminal
result validation. Those remain separate completion authorities.
