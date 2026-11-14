# Output retirement progress

Status: C1–C6 locally implemented and reviewed through21aa880. The cleanup goal’s
ACK/driver, composed recovery, settlement and protected retention items are complete.
[Contract](../design/lld/output-retirement.md) owns authority;
[remaining rewrite packets](../execution/remaining-rewrite.md) own subsequent work.
This is local functional completion, not full release qualification.

| Boundary | Local evidence | Retained limitation |
| --- | --- | --- |
| C1 installed/task identity/control | [Namespace](staging-namespace.md) | Native identity alone is not cleanup proof |
| C2 durable intent/producer drain | [Intent](producer-retirement-store.md), [leases](producer-gate.md), [barrier](producer-retirement.md) | Failed drain remains owned |
| C3 exact runtime/association | [Runtime](runtime-retirement.md), [association](runtime-association.md) | Unknown native state refuses removal |
| C3 native inventory/plan/removal/receipt | [Inventory](task-inventory.md), [plan](cleanup-plan-store.md), [removal](native-removal.md), [receipt](native-receipt.md) | Unknown entries/failed closes remain retained |
| C4 backend control/ACK | [Reservation](backend-cleanup-control.md), [ACK](backend-retirement-ack.md) | Explicit legacy funding; ACK alone gives no credit |
| C4 authenticated request/gateway/driver | [Transport](retirement-transport.md), [projection](backend-retirement-request.md), [gateway](retirement-gateway.md), [driver](cleanup-driver.md) | Shared bounded calls and original ownership remain enforced |
| C4 composed reply-loss/crash | [Composition](cleanup-composed.md), [agent crash](cleanup-agent-crash.md) | Actual platform and overlay-image limits apply |
| C5 exactly-once settlement | [Agent](agent-storage-settlement.md), [backend](backend-storage-settlement.md), [driver](settlement-driver.md), [native](native-settlement.md) | Permanent replay floors survive payload purge |
| C5 absent/no-task originals | [Absence](output-absence.md), [rejected funding](rejected-cleanup-funding.md) | Positive original-bound proof; generic404/timeout is never absence |
| C6 protected retention/delete | [Accounting/API/UI](retention-accounting.md), [parent traversal](retention-parent.md), [driver advisory](retention-driver-state.md), [native](native-retention.md) | Parent coverage live/partial; explicit workspace Apply; no Run-pin UI |

## Completion boundary

Actual native roots, authenticated HTTP and both compiled workers recovered lost
committed replies/reopen, with separate hard-agent-crash/unlink evidence. Settlement
keeps permanent anti-replay identity and credits once. Retention adds immutable
funded previews, stale/conflict checks, metadata-derived progress, completion replay
and explicit acknowledgement. No metadata absence grants physical proof or credit.

The final retention-native path ran one real k6 execution, verified exact debt
transitions and cleaned its synthetic resources. Linux ARM64 agent/engine with a
macOS backend and verified payload overlays is its precise environment. It does
not qualify native AMD64, the Linux backend, final release recipes, packaged browser,
soak/overhead or supported backup/restore. Those remain release/acceptance packets.

Namespace deletion is separate from Run deletion and remains unimplemented.
User services and published images were not changed by this cleanup goal.
