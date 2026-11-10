# Output finalization metadata

Public owner: `OutputFinalizations.execute`, plus bounded ordinary RPC captures.
One immediate transaction verifies the sole source using the shared custody reader,
requires settled release, published slots, exact contiguous events and full ACK,
then inserts one immutable receipt. The insertion trigger alone refunds unused
payload, projects the terminal Run and closes event discovery. Original allocation
and output_pending history remain unchanged; metadata charge stays retained.

The native evidence view is point-filtered by attempt; correlated event/slot reads
use their existing keys. SQL derives the terminal projection once, independently
of sealed child and wrapper exits. Persisted cancellation wins after custody.
Requests and replies are closed and capped at4096 bytes; no source body is copied
into the receipt. Matching replay precedes expected-version checks.

No file/network IO, engine retry, deletion, retention or source-free closure.
Finalization relies on the transfer owner writing publication only after native
original IO settles. Native SQL does not independently observe filesystem custody.
Future accounting reconstruction must subtract immutable receipt refunds from
original input/output charges. Unrestricted direct counter UPDATE remains outside
this receipt authority, matching existing input accounting.

Focused command: `vitest run app/test/output-finalization/*.test.ts`.
