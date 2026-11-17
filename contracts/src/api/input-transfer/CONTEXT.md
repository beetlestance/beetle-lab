# Input transfer client

Public entrypoint: `createInputTransferClient`; public types live in the adjacent
coordinator-owned `input-transfer-types.ts`. Configuration is trusted same-origin
HTTP(S), with fixed session headers and a single deadline per operation.
Requests and options are captured as plain own data (Object or null prototype, no
accessors or unknown keys) without running getters (`snapshot.ts`). Preparation uses
the native Blob `size` getter and `Blob.prototype.arrayBuffer`, never replaceable
instance members (`preparation.ts`).

Preparation uses native Blob read and SHA256 for up to 8 MiB, sharing both slots
and retaining originals through abort. Returned content is caller-owned, uncached.
Append snapshots up to 64 KiB and binds the acknowledgement to immutable metadata
and exact progress. Full downloads preallocate up to 8 MiB, require successful EOF,
and verify native SHA256 before returning bytes. JSON responses are capped 64 KiB.

Two operation carriers bound admission without a queue. Abort fences dependent
work; original fetch/read/cancel/digest work retains its carrier until settlement.
Close synchronously fences intake, aborts carriers and returns a cached drain.
Failed cleanup prevents operation success and rejects close after all drains.
No automatic retries. An adapter ignoring abort can keep the operation pending.

Owning design: `docs/system/contracts/inputs.md#transport-rules`.
Focused check: `node_modules/.bin/vitest run contracts/src/api/input-transfer --maxWorkers=1`.
