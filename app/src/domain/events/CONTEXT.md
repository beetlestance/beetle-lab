# Event evidence capture

Public entries: captureEventBinding and prepareEventBatch in index.ts.
Pure descriptor-safe capture; <=100 events/262144 bytes independently of carrier.
Inputs bind run/attempt/scope/digest/generation1 and canonical journal UUID.
Validate schemas, all nested identities, retained start and contiguous sequences.
Empty nextCursor stays at after; safe integer overflow and cursor leaps reject.
Outputs are immutable canonical event records with UTF-8+128 logical byte charge.
EventBatchError exposes bounded codes, no peer data. No SQL/network/Run projection,
output settlement or remote ACK occurs here. Stored durability must be checked by
the metadata transaction before replay comparison/inserts and ACK authorization.
Contract: docs/design/lld/event-custody.md. Tests: app/test/domain/events.
