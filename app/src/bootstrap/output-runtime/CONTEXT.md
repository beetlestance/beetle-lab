# Output runtime

Public entry: `openOutputRuntime` in `index.ts`; frozen port in `ports/output-runtime.ts`.
Owns private native roots/lease, transfer service and one bounded discovery loop.
Two exact bindings retain transfer, proof, snapshot, Run and finalization originals.
Metadata, gateway and Run readers stay externally owned. No engine operations.
Owns at most two children: exports and committed backend-file deletion.
Close fences synchronously and releases files after all child/metadata originals.
Deletion retains producer authority/charges; source cleanup/refund remains separate.
Fatal errors fence new work and notify once; retry state contains fixed codes only.
Focused checks: `npx vitest run app/test/output-runtime`.
Exact source_absent after both originals enables retained proof custody/finalization.
Pending execution refreshes one full bound snapshot through existing observe, then
rereads Run/version and retries once. Required capabilities bind before native awaits.
