# Output runtime

Public entry: `openOutputRuntime` in `index.ts`; frozen port in `ports/output-runtime.ts`.
Owns private native roots/lease, transfer service and one bounded discovery loop.
Two exact bindings retain result, settlement, Run read and finalization originals.
Metadata, gateway and Run readers stay externally owned. No engine operations.
Close fences synchronously and releases files after producers and metadata originals.
Fatal errors fence new work and notify once; retry state contains fixed codes only.
Focused checks: `npx vitest run app/test/output-runtime`.
Actual metadata finalizer composition is deferred until its owner lands.
