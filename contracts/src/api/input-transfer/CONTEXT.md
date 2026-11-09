# Input transfer client

Public entrypoint: `createInputTransferClient`; public types live in the adjacent
coordinator-owned `input-transfer-types.ts`. Configuration is trusted same-origin
HTTP(S), with fixed session headers and a single deadline per operation.

Preparation uses native Blob read and SHA256 for up to8MiB, sharing both slots
and retaining originals through abort. Returned content is caller-owned, uncached.
Append snapshots up to64KiB and binds the acknowledgement to immutable metadata
and exact progress. Full downloads preallocate up to8MiB, require successful EOF,
and verify native SHA256 before returning bytes. JSON responses are capped64KiB.

Two operation carriers bound admission without a queue. Abort fences dependent
work; original fetch/read/cancel/digest work retains its carrier until settlement.
Close synchronously fences intake, aborts carriers and returns a cached drain.
Failed cleanup prevents operation success and rejects close after all drains.
No automatic retries. An adapter ignoring abort can keep the operation pending.

Owning design: `docs/design/lld/input-client.md` and `input-http.md`.
Focused check: `node_modules/.bin/vitest run contracts/src/api/input-transfer --maxWorkers=1`.
