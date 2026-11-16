# Backend settlement

Exact private source/absence/positive-unsent compaction and replay. No native IO.
The owning projection reuses cleanup control, terminal Run, file receipts, retained
closure/events and immutable cleaned ACK. Actual agent reply precedes credit.
A fixed bounded purge transfers existing remaining debt to a permanent2560 floor.
Global receipts, revisions, input pins and input blobs are retained without credit.
The standalone transaction keeps foreign_keys ON, defers cyclic checks until COMMIT,
and never turns deferral off early. Unknown restoration poisons the connection.
Contract: docs/design/lld/output-settlement.md. No public retention API here.
