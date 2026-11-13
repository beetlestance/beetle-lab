# Output deletion metadata

Public entry: OutputDeletions through Store and Metadata.outputDeletions.
Owner contract: docs/design/lld/output-deletion-store.md; private port
app/src/ports/output-deletion-metadata.ts. Migration013 owns additive guards.

Begin participates in the shared receipt-first Store transaction. Other operations
own one immediate transaction. Capture bounded requests before replay, and bind
replies at worker and caller seams. Discovery<=32, files<=128, each record<=8KiB.
No native IO, remote calls, public route or scheduler lives here.

Facts require immutable finalization and released execution/closed events, or
positive single-attempt unsent-cancellation witnesses. Legacy absence is unknown.
Persist actual native preparation before unlink; reconstruct exact original file
records from retained source/slot owners. First namespace is immutable. File
progress1->2->3 and intent progress are separate from deletion generation1.
Matching replay does not advance counts. Committed intent fences new artifact reads.

ALL old rows and charges remain. Files_absent only witnesses backend published
files; producer retirement, purge and refunds require separate reviewed authority.
Tests: app/test/output-deletion/{store,guards,boundary,migration,native-worker}.test.ts.

ACK owner acks.ts reuses exact C4d request derivation; cleanup-ack-guard performs one
fixed synchronous permit-bound INSERT. Canonicalbody<=4096+512row in policy1 ACKbucket.
Read/replay immutable; pending/unsent refuse; no driver/refund/nativeproof implied.
