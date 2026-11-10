# Finite durable run event reads

Public entrypoints: RunEvents, captureRunEventsOperation, captureRunEventsReply.
A synchronous transaction resolves the scoped Run and its active owned attempt,
captures event high-water/coverage and reads only the indexed contiguous prefix.
Request <=4096 bytes; reply <=100 events/262144 complete JSON bytes.
PK key reads plus cumulative charges reserve 4096 envelope bytes before body reads;
each admitted body <=65536 bytes. No history scan, second journal, cursor insert,
ACK update, refund, lifecycle transition, files or network work occurs here.
Wrong scoped run is not_found; invalid position is invalid_input; storage damage
is unavailable. Worker original ownership includes bounded semantic reply capture.
Contract: docs/design/lld/run-event-reads.md. Tests: app/test/run-events.
