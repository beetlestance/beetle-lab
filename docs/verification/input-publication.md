# Local input publication evidence

Verified runtime source: `996f5b1`, 2026-11-09, local `rewrite/integration`.
Scope: actual application metadata/files, provider/Stager compatibility and shared
HTTP foundations. Public upload routes, browser transfers and UI remain unimplemented.

## Implemented behavior

The application input service owns global2/per-input1 byte operations with no waiting
queue. Metadata-only create preserves its original receipt snapshot. Seal/delete
serialize current-row work behind accepted intent. Append advances only after native
durability; earlier identical chunks preserve offset/version. Unknown metadata outcomes
are not reissued. Transient IO preserves recoverable custody and storage charges.

The native adapter uses private same-UID files/directories, bounded chunks, canonical
ancestry checks and retained original descriptors. Publication uses no-overwrite hard
link promotion with parent flushes, exact two-alias recovery and verified single-link
destination before metadata publication. The empty-file exception requires the exact
empty digest and both names absent. Explicit deletion permits corrupt single-linked
owned files; two-name aliases require the complete declared size/hash proof.

Real application publication passes through InstalledProviders and the actual Stager
in a separate service-owned subprocess fixture. Cases cover binary UTF8 split across
chunks, empty seal without append, persisted metadata reopen and original-create replay.
Independent file bytes/hash/link/mode assertions pass. Changing published bytes later
causes Stager input_integrity failure before any engine launch. Docker inspection is
controlled; this is not native k6 execution or a public upload workflow.

## Review and checks

Independent service review found valid maximum-Unicode pages exceeding the initial
64KiB envelope. A page-only128KiB bound and real SQLite100/101-row regressions corrected
it; control/key/record limits remain unchanged. Coordinator review corrected an overly
broad two-alias deletion oracle; corrupt aliases now remain untouched. Independent
intake/custody and publication/deletion reviews cleared the corrected native source.
An independent review also cleared the two-file publisher/provider/Stager harness.
All11 service,20 native and2 harness file hashes matched at integration.

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0 on the source above:

- Generation37 runner/31 API/6 k6 outputs and all three TypeScript projects passed.
- Lint, architecture853 and documentation136 passed.
- Frontend build passed; its main-chunk size warning remains.
- All2,823 tests passed across259 files in320.35s, one file worker.

Before that gate, the composed service/native/bridge batch passed100 tests in11 files
and the final bridge-only rerun passed3 tests. Source-only opinions do not replace
this execution evidence. Environment: Node26.7.0, macOS arm64. The functional lane
does not certify parallel engine stress or measured RSS/latency.

## Remaining boundaries

The [input HTTP contract](../design/lld/input-http.md) has an independently reviewed
framing correction: nonempty HTTP/1.1 replies withhold terminal chunk framing until
final verification/close, and empty replies withhold headers. This is a contract,
not an implemented or runtime-qualified download endpoint.
Binary HTTP/session integration, browser transfers, UI, startup maintenance beyond
one page and complete run/artifact application flow remain. Actual power-failure
durability, Node24/container platforms, image rebuilds, native architecture matrix,
resource abuse/overhead, backup/soak and release qualification remain unproven.
