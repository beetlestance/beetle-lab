# Source-free settlement evidence

Status: locally implemented, independently reviewed and integrated. A real public
API rejection and an affected real k6 positive control passed on 2026-11-11.
This is functional evidence, not release qualification.

Contract: [source-free closure](../design/lld/output-absence.md).
Native commands: [qualification tools](../../tools/qualification/native-application/README.md).

## Implemented path

The Journal records immutable physical identity, definitive admission and stream
end after the installation owner drains actual producers. Unknown launch,
unsettled native work and pending publication grant no absence authority.
Cold settled recovery uses the existing backend's read-only inspection through
a fenced Supervisor owner; it cannot launch, stop or add a late timeout cause.

Authenticated source GET exposes an absence marker only from a durable proof.
The backend waits for transfer result and native settlement, adopts that proof,
and finalizes through separate immutable metadata tables. An older header requires
a full bound snapshot through normal observation before retrying finalization.
This preserves the final provisional result; events cannot replace its snapshot.

Finalization requires exact physical/admission/sequence binding, released execution
and full event custody. It retains charged events and actual provisional result
bytes, credits unused payload once, and preserves 65,536 bytes of metadata allowance.
Cancellation wins. Absence produces cancelled or errored/inconclusive with pending
validation, never a successful engine result or a fabricated source receipt.

## Real native cases

Tested application/agent source: `99f0e02043dd11ca825ee8edc0e2955b93b50e8c`.
The compiled backend inputs are unchanged from `6fba106`; their source identity was
checked before reuse. Host backend: Node 26.7.0/macOS. Containers: Node 24/Linux,
native arm64 Docker Desktop 29.9.2. The existing k6 image was reused.

| Image | Local immutable ID |
| --- | --- |
| Agent | `sha256:d7fe4681a1658bf01956abb15eb1bd1539ff884d4c153711892904bb1e51eaed` |
| k6 | `sha256:ffee668028c6086bd43bf02254dc42b7672c29b9de2506097bbc3e589e69f333` |

The rejection command sent 999 CPU millicores against the installed minimum 1,000, leaving
the private manifest/profile and backend ceilings unchanged. Actual agent
admission recorded `below_manifest_minimum`; the public Run became
errored/inconclusive, reason budget_unavailable, with a null result.

- Command exited 0 in 8.47s, including checks and cleanup.
- Physical Journal proof and backend receipt agreed at sequence 0 with full ACK.
- Zero engine containers, readiness requests, work requests and unexpected requests.
- Payload retained 0; refund 16,777,216; remaining metadata allowance 65,536.
- Public reads, complete original allocation and accounting survived metadata
  reopen; wrong-workspace reads returned 404. Exact-label cleanup passed.

The positive control requested the actual minimum of 1,000 CPU millicores and ran real k6 once.
It exited 0 in 11.24s with a finished/passed result, native seal/artifact verification,
one readiness and one work request. Retained payload 21,693 plus metadata 65,536
matched the accounting; refund 16,755,523. Reopen and cleanup passed. This positive
control had one container-log retrieval failure, so complete log capture is not
claimed. The rejection case had no diagnostic retrieval failures.

## Scoped evidence and corrections

Native/compiled storage controls cover immutable proof, quota, source exclusion,
zero/event gaps/full ACK, result retention, replay, cancellation and late writes.
Runtime controls hold proof, snapshot, observation and finalization originals
through shutdown. Synthetic cold-recovery controls exercise read-only inspection,
held actor lanes and unknown/foreign/running runtime refusal.

The initial real rejection failed before agent original custody. Catalogue and
Journal intake returned policy refusals before persisting them. Intake now retains
the original request and policy rejection atomically. Catalogue's boolean native
feasibility probe does not change requested limits or authorize execution; actual
runtime preparation remains strict. The failed native evidence is retained.

Two older release controls supplied finished collection without source authority.
Their updated fixtures preserve failed-collection chronology/privacy and exercise
finished success through actual publication and its receipt. Both affected files
passed 11 cases; production release guards were unchanged.

Private evidence retains source hashes, commands, results and native data. Some
agent-retirement component executions were recorded from tool output without raw
transcript files; that limitation remains explicit. No repeated full suite is
claimed from the scoped controls or native cases.

## Remaining qualification

Browser, shipped backend/Compose, native amd64, concurrent stress, execution-time
crash recovery, real cold stopped-container recovery, resource abuse, scans,
backup/restore, soak and release qualification remain outstanding. Publication
acknowledgement, deletion and retention are separate unfinished lifecycle work.
