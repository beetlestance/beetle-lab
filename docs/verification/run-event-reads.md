# Public durable run event reads

Status: locally implemented, independently reviewed and integrated. Contract:
[finite event reads](../design/lld/run-event-reads.md).

The authenticated public route reads existing durable event custody through the
metadata worker and generated API client. It resolves run scope first, validates
attempt-bound canonical cursors and returns at most 100 events/256 KiB. SQL admits
bounded keys and cumulative charges before loading event bodies. Empty pending and
caught-up reads are distinct from partial coverage and storage errors.

Shared pure helpers bind every event's namespace, attempt, generation and contiguous
sequence, enforce requested limits and validate resume/next cursor progress. Missing
reader capability returns unavailable; production bootstrap supplies the real reader.
GET does not create event cursors, acknowledge events, mutate runs or alter charges.

## Evidence

Reviewed component source: `74fa66b`, based on contract snapshot `973cc40`.
Coordinator verified all 20 submitted source hashes and reviewed storage, worker,
HTTP/bootstrap, client guards and failure oracles. Worker independently reviewed
the coordinator-authored contracts before implementation.

Scoped end-to-end tests passed 26 cases; changed client guards passed 18 and final
storage controls passed 11. These overlap. Coordinator's composed HTTP seam passed
2 cases in 3.78s; architecture checked 1,608 files. Changed lint and Node types passed.

The seam uses actual metadata ingestion, a compiled task-owned worker, local
session pairing and synthetic TCP. It checks resume, empty polls, namespace/origin
refusal, reopen and identical event/ACK/allocation/storage facts before and after.
Three valid 65,536-byte events fit a page; a corrupt fourth body is not materialized
until its own page, which fails. A separate exact serializer-cap test uses synthetic
padding outside the wire schema and is not claimed as valid wire-page evidence.

Earlier input-mapping, fixture-limit/cursor and lint failures remain in private
logs. Sandbox loopback denial was followed by normal scoped escalation. No denied
action was bypassed. The contract generation fixture also now copies its required
runner schemas and covers the existing pending result response.

## Limits

No full suite, browser, SSE, metric-window emission, native image or release
qualification is claimed. This finite reader supports later UI polling and event
replay; it does not itself implement live charts or a historical metric store.
