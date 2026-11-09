# Backend output storage allocation

Status: SQL reservation helper implemented; claim wiring and artifact adoption pending.
Owner: application metadata worker. [Dispatch](dispatch-storage.md) reserves execution
resources; [input publication](input-publication.md) owns existing input byte custody.
This is a logical byte allowance, not a filesystem quota or a physical free-space
reservation against other host applications.

## Shared accounting

Reuse installation_storage_usage.charged_bytes, currently updated by input lifecycle
triggers. Add one attempt_output_allocations row per claimed original. No second
usage counter and no subtraction of the same reservation twice. Atomic reserve and
input creation serialize in the same immediate worker transaction owner.

The initial charge is immutable Offer.budget.outputBytes plus 65536 bytes of output
metadata allowance. Charge the declared maximum before possible delivery. Check safe
arithmetic and current usage + new charge +effective reserve <= effective allocation.
Effective allocation is min(current installation storageBytes, fresh source storage
ceiling); reserve is max(their freeSpaceReserveBytes). Use one shared storage-fit arithmetic owner
for new input and output reservations. Execution output additionally requires the
fresh dispatch observation. Input authoring keeps its existing configured allowance
when the agent is unavailable; no new agent-readiness gate is added to uploads.
Receipt replay and already-owned byte lifecycle work remain independent of it.

InputStorage.storage remains an observational usage/configuration view; reading it
does not grant new reservation permission. Existing reservations survive lower
settings/unknown sources and drain. Source filesystem available-byte checks remain
separate write-time safety evidence; they never replace a total logical allowance.

Scope each row to the exact run/attempt/organisation/workspace, with immutable
maximum bytes, metadata allowance and identity. Reject REPLACE, overflows and direct
negative/unsafe usage changes through owned lifecycle transitions. Allocation version
is a safe positive integer; only its owner advances it. Never delete an active or
unknown allocation to satisfy a disk target.

## Transfer and retention ownership

Physical execution release does not release this reservation: sealed output may
still need transfer. Output publication must adopt this existing allowance, not add
an unaccounted second copy. All output/control/report writes stay within declared
budgets and bounded artifact metadata; staging and interrupted transfer stay charged.

A future separately frozen artifact/finalization transaction may settle the reserved
payload to verified retained bytes only after original writers/transfer quiesce,
manifest closure and durable publication. Release only the unused allowance then;
keep retained bytes plus metadata charged. Missing/failed/partial transfer is not
proof of absence. A refused or never-started run still needs its own nonexecution
finalization before releasing unused output allowance. No settlement operation is
exposed by this dispatch port and no schema-only proof authorizes it.

Deletion requires durable absence after retention/delete intent before releasing
retained bytes/metadata. Preview, terminal state, event ACK, CPU/RAM release, timeout
or canceled request is insufficient. Recovery reuses original allocation identity.
Finalization, adoption and deletion APIs are separate owner contracts before code.

## Evidence scope

This counter covers input/output payload allowances and their declared metadata
charges. It is not a measurement of SQLite/WAL, indexes, temporary tooling or the
whole host filesystem. Those control-service resources retain their own bounds and
backing-store reserve/failure handling; do not advertise an exact whole-directory
quota from this logical counter.

Acceptance: competing input/output reservation, exact boundary/overflow, transaction
rollback and replay, changed limits/expired source, physical release retaining
storage, wrong scope, REPLACE and deletion guards, preserved charge on interrupted
transfer; later artifact adoption/retention must prove unused/retained byte custody.
