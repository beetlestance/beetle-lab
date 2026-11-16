# Authenticated run metadata routes

Public entrypoint registerRunRoutes in index.ts wires shipped create/list/get
operations to application run ports. Required onRequest authorization owns local
session/Host/Origin/CSRF before parsing; enqueue body<=64KiB and scope must match
before allocation/time/store effects. Two IDs/one timestamp are trusted inputs.
202 follows durable receipt settlement, retaining original IDs on replay. Queries
are observational; application replies are bounded/scoped before serialization.
History uses RunListQuery: strict HTTP limit decoding and exact state/outcome/order.\nMalformed query fields return400; legacy/mismatched cursor semantics return422\nbefore a reader call. See run-history-query.md for canonical keyset/page binding.\nNo retry, dispatch, cancellation, target request or agent credential lives here.
Contract: docs/design/lld/run-intake.md. Check: app/test/http/runs and bootstrap/run-intake.test.ts.

Finite event reads use the optional RunEventReader (required in bootstrap), existing
durable storage and a <=100-event/262144-byte page, with scoped canonical resume
cursors and semantic validation. No SSE/ACK effects. Contract: run-event-reads.md;
checks: app/test/run-events and contracts/test/api/client/run-events.test.ts.
