# Output retirement progress

Status: local prerequisite and transport evidence; full cleanup remains incomplete.
This index records implementation scope. [Execution order](../execution/output-retirement.md)
owns remaining work; [retirement contract](../design/lld/output-retirement.md) owns authority.

| Boundary | Local evidence | Remaining limit |
| --- | --- | --- |
| C1 installed/task identity and control | [Namespace](staging-namespace.md) | Native identity is not cleanup proof |
| C2 durable intent and actual producer drain | [Intent](producer-retirement-store.md), [leases](producer-gate.md), [barrier](producer-retirement.md) | Failed drain remains owned |
| C3 exact runtime removal | [Runtime](runtime-retirement.md) | Cold mailbox association gap stays unresolved |
| C3 bounded native ownership and inventory | [Custody](native-custody.md), [inventory](task-inventory.md) | Observation alone grants no unlink authority |
| C3 immutable native plan and recoverable steps | [Plan](cleanup-plan-store.md), [removal](native-removal.md) | Partial/unknown outcomes stay charged |
| C3 trusted durable native receipt | [Receipt](native-receipt.md) | Raw rows/counters do not prove IO |
| C4 exact wire values and local pipeline | [Wire](retirement-wire.md), [pipeline](retirement-pipeline.md) | No backend ACK or settlement |
| C4 authenticated runner endpoint | [Transport](retirement-transport.md) | Real TCP uses synthetic Docker observations |
| C4 committed backend request | [Projection](backend-retirement-request.md) | Read-only; no dispatch or ACK |
| C4 exact bounded installation gateway | [Gateway](retirement-gateway.md) | No background driver or ACK storage |

Next: review the [backend ACK proposal](../design/lld/backend-retirement-ack.md), freeze
its control reservation and private port, implement immutable ACK storage and bounded
driver discovery, then qualify both compiled workers with actual native roots and
authenticated HTTP through lost replies/reopen. Do not promote separate leaf/mocked
successes to full C4 acceptance. C5 separately owns exact-once settlement/tombstones;
C6 owns public retention and deletion. All existing charges remain until their owners
have positive exact evidence.

Matched Linux arm64 images at0f0afbb passed one actual k6 application smoke in14.56s,
including normal fixture resource cleanup. That test covers normal execution, not the
output-retirement endpoint or full backend cleanup chain. Native amd64 execution,
full crash/resource/release matrix and UI redesign remain separate work. Running user
services and published images were unchanged during this bounded source session.
