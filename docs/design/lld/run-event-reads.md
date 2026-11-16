# Public durable run event reads

Status: accepted implementation contract. Reuses
[event custody](event-custody.md), without changing ingestion, ACK or accounting.
This page owns finite reads; SSE and metric-window emission are separate work.

## Public contract

`GET /api/v2/organizations/:organizationId/workspaces/:workspaceId/runs/:runId/events`
uses the existing local session guard and generated `listRunEvents` operation.
Query is PageQuery: required limit 1..100 and optional opaque cursor <=512 bytes.
Response RunEventPage contains the scoped run/active attempt, generation1,
afterSeq, durableThrough, coverage, blockedReason, retainedStartSeq, items,
resumeCursor and nextCursor. The complete encoded page is <=262,144 bytes.
Items reuse AgentEvent schema; do not invent another lifecycle union.

Resolve the exact scoped run before event/cursor reads. Wrong organisation,
workspace or run returns404. Cursor binds namespace/run/attempt/generation and
last returned sequence, using a canonical base64url closed JSON value; it is a
position, never an authorization capability. Validate shape/bytes before parse,
case-normalize UUIDs, reject extra fields and noncanonical encodings. A foreign
binding is invalid_input; future/negative/unsafe sequence is invalid_input.
An old active-attempt binding requires a fresh snapshot; never mix attempts.

Without a cursor, afterSeq is0. resumeCursor always encodes the last sequence
returned, or afterSeq for an empty page. nextCursor equals resumeCursor only when
more currently durable events remain; otherwise null. Clients poll resumeCursor
for later events. durableThrough is the captured storage high-water, not physical
termination, engine success, a remote ACK or a promise of later completeness.

A queued/not-yet-observed run without event_cursors returns an empty pending page,
high-water0 and null problem/retained-start. It does not create cursor rows. Existing
cursor coverage/blockedReason/retainedStartSeq are preserved, including a partial
stream with a durable contiguous prefix. Public run state is read separately.

## Storage and RPC

Add a dedicated RunEventReader port with getRunEvents({scope,id,limit,cursor?}).
Metadata exposes it as runEvents; metadata worker operation is getRunEvents and
returns RunEventPage. Keep it separate from delivery-only EventCustodyStore.
No migration or second journal: use existing runs, event_cursors and run_events.

One synchronous read snapshot binds Run.active_attempt_id and its owned
execution/cursor, then selects records through captured durableThrough. Point
lookups and existing PK(attempt_id,generation,seq) must bound work. Never select
an entire event history and slice it in JavaScript. Check exact run/scope/generation
on cursor and events. Validate each bounded stored event and its sequence/identity;
corrupt JSON/data returns storage unavailable, never a successful shortened page.

Use cumulative_bytes and a prior-cursor point lookup to constrain returned encoded
payload before materialization. Reserve envelope/cursor headroom within the page
cap; select <=limit+1 keys if needed, but read <=100 admitted event bodies. Each
body remains <=65,536 bytes. Final bounded serialization confirms the full cap.
If the first event cannot fit, report unavailable rather than loop with no progress.
Canonical event bytes plus existing row charge make this conservative: no refund,
ACK, Run mutation, source adoption, engine effects or schema write occurs on GET.

Shared pure captureRunEventCursor/encodeRunEventCursor/runEventPageMatches helpers
are exported from contracts/api; storage and client reuse them. Cursor position
contains organizationId/workspaceId/runId/attemptId/generation/afterSeq.
Metadata input/reply codecs validate this new boundary. Client validation binds
page scope/run and every event to activeAttemptId/generation, requires contiguous
sequences starting afterSeq+1, items<=requested limit and lastSeq<=durableThrough,
checks complete byte cap and pending/coverage/problem coherence. Existing generic
route ownership checks remain. The backend composition supplies the actual reader;
missing reader is unavailable, never fabricated empty success.

## Acceptance

Exercise actual public API after real metadata event ingestion, cursor resume,
empty caught-up reads, queued pending reads and reopen. Include wrong scope/run,
foreign/stale/future/malformed cursors, limit and exact byte boundary, corrupt or
wrong-identity stored events, partial coverage, API client mismatches, and unchanged
accounting/ACK snapshots before/after reads. Use synthetic private temp SQLite/TCP
fixtures; no Docker/build/native qualification needed for this batch.

Workers run scoped changed tests/lint and affected types once. Coordinator reviews
exact source and runs one composed seam after integration. Preserve prior schema,
client, delivery and result behavior. Browser consumption, SSE, sample aggregation,
metric event framing and telemetry quotas remain unfinished follow-on batches.
