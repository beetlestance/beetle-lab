# Local input publication evidence

Latest verified runtime source: `8308ec8`, 2026-11-09, local `rewrite/integration`.
Scope: application metadata/files, provider/Stager compatibility, guarded HTTP and
configured startup/recovery. Browser transfers and input UI remain unimplemented.

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

At the earlier `996f5b1` checkpoint,
`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0:

- Generation37 runner/31 API/6 k6 outputs and all three TypeScript projects passed.
- Lint, architecture853 and documentation136 passed.
- Frontend build passed; its main-chunk size warning remains.
- All2,823 tests passed across259 files in320.35s, one file worker.

Before that gate, the composed service/native/bridge batch passed100 tests in11 files
and the final bridge-only rerun passed3 tests. Source-only opinions do not replace
this execution evidence. Environment: Node26.7.0, macOS arm64. The functional lane
does not certify parallel engine stress or measured RSS/latency.

## Configured HTTP and recovery

Source `8308ec8` composes the actual input service, guarded binary/control routes,
private durable staging/publication roots and bounded pending-only maintenance.
Empty pending publication recovers after restart; published bytes survive restart,
and previous session cookies lose authority. No agent capacity is fabricated.

Independent startup review found maintenance failure could finish close before
another original drained and skip metadata cleanup. A held service metadata-call
regression first failed, then passed after all initiated drains settled before
reporting failure. Application and direct-server close tests await real metadata
close after a substituted failing runtime. These are composition tests, not native
byte-read fault injection. Directory initialization separately retains an unknown-close
handle and pending startup, fences another initialization and never retries that close.
Its test closes the actual descriptor before exposing a synthetic failed outcome.
Independent correction review found no remaining source blockers.

The full gate command above exited0 on `8308ec8`: 2,886 tests/275 files in363.94s,
generation37/31/6, all three TypeScript projects, lint, architecture886/docs138 and
frontend build. Its 628KB main-chunk warning remains. The functional lane uses one
file worker and does not qualify parallel engine stress.

`npm run build:api` and `npm run smoke:api` also exited0 on this runtime source.
The compiled smoke uses disposable private storage and real loopback HTTP/session,
SQLite and native files: a 65,543-byte two-chunk upload, seal/status, fully terminated
chunked download, deletion, logout and clean SIGTERM. No engine starts. Its first
attempt failed because the domain fixture's 10KB storage budget cannot cover one
input's 64KB metadata charge; the smoke now explicitly allocates a synthetic 2MB pool.

## Remaining boundaries

The [input HTTP contract](../design/lld/input-http.md) has an independently reviewed
framing correction is implemented: nonempty HTTP/1.1 replies withhold terminal chunk
framing until final verification/close, and empty replies withhold headers. Raw socket
tests exercise actual HTTP completion; delayed final service failure is controlled,
not an injected operating-system close failure.
Browser transfers/UI, frontend proxy completion semantics, native restart recovery
across multiple pending pages and the complete run/artifact application flow remain.
An unknown startup directory-close remains quarantined until process exit; no
automatic recovery is claimed. Actual power-failure
durability, Node24/container platforms, image rebuilds, native architecture matrix,
resource abuse/overhead, backup/soak and release qualification remain unproven.
