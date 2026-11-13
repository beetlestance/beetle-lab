# Backend cleanup control reservation

Status: policy1 locally verified; whole-chain cleanup qualification remains separate.
Parents: [output allocation](output-allocation.md), [backend ACK](backend-retirement-ack.md).
Owner: backend cleanup-control metadata adapter; independent of agent Journal control.

Policy1 reserves65,536 logical bytes per exact performance original. It uses one
immutable original-keyed ledger row and the existing installation_storage_usage counter.
This is an additional explicit charge, not spare space borrowed from the existing
65,536 output metadata allowance. No physical SQLite/WAL or host disk quota is claimed. This backend policy does not
qualify standalone-export cleanup capacity. Agent C1 independently reserves control
for both purposes; missing export backend proof never means zero cleanup debt.

| Consumer | Reserved bytes |
| --- | ---: |
| Deletion intent, including logical row allowance | 4096 |
| Up to128 compact file progress cells, each384 | 49152 |
| One canonical ACK<=4096 plus512 row allowance | 4608 |
| Future compact tombstone<=2048 plus512 | 2560 |
| Control ledger row | 1024 |
| Reserved slack | 4096 |
| Total | 65536 |

A file cell is the canonical array of persisted deletion UUID, attempt UUID, ordinal,
original version, progress version, namespace/preparation hashes and absent flag.
Worst-case UTF-8 array size is238 with safe integer versions, plus128 logical row
bytes =366<=384. No filename, artifact body, free-form error or config belongs here.
Tombstone use must independently prove its fixed bucket before C5 implementation.
Do not add a logical consumer by silently consuming slack or hiding it in event payloads.

For new delivery, reserve atomically with the output allocation before possible_delivery
can become1. Check the combined payload+old metadata+cleanup charge against the same
fresh effective claim capacity and reserve. Ledger insert checks safe arithmetic,
original Run/attempt/scope, configured installation ceilings and available shared usage;
its trigger applies the single charge. A later failed claim rolls back both charges.
Existing output/finalization accounting remains unchanged. Exact replay reuses the
first reservation independently of later lowered limits; replacement/mutation/deletion
are forbidden until C5 provides a reviewed settlement transition.

Migration preserves all old data/counters and creates no fictional reservation. Missing
ledger means positively unreserved. Legacy and positively unsent originals require
explicit admission/top-up under current configured storage policy before deletion
preparation, removal, or agent retirement. New Begin reserves before committing intent;
resumed legacy intents use the private reserveControl operation. Its replay does not
charge again. Read-only file/request projection refuses an unreserved intent before
native dispatch; SQL guards also refuse new deletion/progress without the ledger.

An old installation with insufficient top-up capacity retains its data, charges and
progress. It needs available configured capacity before cleanup can continue; the new
policy cannot retroactively guarantee old headroom. New originals reserve ahead of
load so a full logical pool cannot consume their cleanup allowance. Storage admission
is distinct from physical writable-space checks; failed writes stay owned/charged.

No ACK storage, final settlement, refund, purge or public retention behavior is added
by this reservation. C5 must account for the residual charged tombstone before releasing
this reserve. Agent control capacity remains in its own separately charged owner.

Acceptance: exact combined-capacity boundary/overflow, rollback, competing input claim,
immutable replay, wrong original/scope, direct SQL overcharge/REPLACE/mutation/deletion,
actual compiled worker/reopen, schema20 preservation and explicit legacy top-up before
resumed native work. Budget vectors independently check all bucket arithmetic.
