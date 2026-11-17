# Authenticated run metadata routes

Public entrypoint registerRunRoutes in index.ts wires shipped create/list/get
operations to application run ports. Required onRequest authorization owns local
session/Host/Origin/CSRF before parsing; enqueue body<=64 KiB and scope must match
before allocation/time/store effects. Two IDs/one timestamp are trusted inputs.
202 follows durable receipt settlement, retaining original IDs on replay. Queries
are observational; application replies are bounded/scoped before serialization.
History uses RunListQuery: strict HTTP limit decoding and exact state/outcome/order.
Malformed query fields return 400; legacy/mismatched cursor semantics return 422
before a reader call. Keyset/page binding: docs/system/contracts/public-api.md#run-history.\nNo retry, dispatch, cancellation, target request or agent credential lives here.
Contract: docs/system/contracts/run-lifecycle.md. Check: app/test/http/runs and bootstrap/run-intake.test.ts.
pin/unpin: body<=4096 B and matching scope before the store; the server clock stays
outside the intent. pinned=true is the only accepted literal for the list filter.

Finite event reads use the optional RunEventReader (required in bootstrap), existing
durable storage and a <=100-event/262144-byte page, with scoped canonical resume
cursors and semantic validation. No SSE/ACK effects. Contract: public-api.md#run-event-reads;
checks: app/test/run-events and contracts/test/api/client/run-events.test.ts.
