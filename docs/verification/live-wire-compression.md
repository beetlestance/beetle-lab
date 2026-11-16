# Bounded live-wire compression

The [actual long trial](long-stream.md) failed fresh-reader coverage. Its retained,
hash-verified native windows reproduced the mailbox sink's lifetime-byte rejection
near28½min. This was a quota failure mechanism, not an API-latency target miss.

V2 gzip encoding preserves the full20-series snapshot,2s cadence,8MiB lifetime
wire allocation and64KiB decoded-frame bound. The publisher caps gzip output at
64KiB, bills compressed bytes, and checks its clock again before issuance. The
sink still charges every header write and hashes the exact wire bytes. The agent
checks the fixed envelope/hash before bounded decompression and the unchanged
schema/scope/subset/sequence/freshness checks. The trusted image marker becomesV2;
there is no plaintext fallback. Public HTTP snapshot shape is unchanged.

Focused source checks passed45 tests across producer/reader/approval suites.
They cover malformed/plaintext gzip refusal, decoded65537-byte expansion refusal,
exact decoded65536-byte acceptance, envelope corruption, exact compressed quota
and quota-minus-one, plus existing ordering/cancellation/deadline behavior.

The same1836 native-window corpus was replayed through the changed publisher/sink:
all918 frames retained all20 selected metrics, charging1795202 of8322816bytes,
with no failure. Before the change,852 writes charged8318200bytes and the next
9292-byte frame received an actual sink `quota` rejection. Source/corpus hashes
and both results remain private evidence. Replay uses bounded in-memory writes;
it does not establish native filesystem behavior, overhead or30-minute stability.

Independent source review found no remaining budget/integrity/decompression
blocker. Matching-image CI and native long-run resource/freshness/final-drain
qualification remain required. Existing publishedV1 bundles remain unchanged;
this evidence does not publish or qualify a new public release.
