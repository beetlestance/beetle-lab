# Public finite event query

Public entrypoint getRunEvents accepts RunEventsQuery and RunEventReader.
The original read remains owned until complete <=262144-byte schema/semantic
capture checks scoped identity, requested cursor/limit, event contiguity and
coverage/problem coherence. The shared contracts helper owns cursor semantics.
No polling loop, subscriptions, ACK, engine, storage mutation or retry occurs.
Reader failures propagate; contradictory replies fail explicitly.
Contract: docs/design/lld/run-event-reads.md. Tests: app/test/run-events.
