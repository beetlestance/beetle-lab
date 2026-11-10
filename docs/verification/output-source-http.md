# Agent source HTTP evidence

Status: locally verified components and native agent HTTP composition. This does
not qualify backend artifact publication, a complete k6 run or a release image.

## Accepted source

- Source service: `efcc7a7ced889c89a8cccb737c0a15c5358f1d46`.
- Bootstrap/native composition: `232fe29` (integrated by `5ffd1495`).
- HTTP implementation: `237cc4acaafc3d360513b101ff32602cef12ff6b`.
- Full-range EOF fixture correction: `012f235`; test oracle only.
- Source lookup transition correction: `41f5fb9` (integrated by `7e22121`).
- Type import cycle correction: `67ce005`; unchanged interfaces moved to types.ts.
- Native HTTP composition test: `1b2f113` (integrated by `89916b6`).

## Evidence and limits

The source reader uses actual Journal source/closure records and the existing
native range owner. Its focused cases cover exact authority/selectors, bounds,
missing closure, cancellation and retained original cleanup. The lookup correction
rereads a missing source once after a matching released/refused snapshot; two
real Journal regressions reproduced stale absence before the fix. All 12 focused
lookup cases passed in 3.18s, with changed-file lint in 1.17s.

HTTP has two source operations within the shared 32-request window, reserved
before parsing and held through service work and socket cleanup. Source body and
response caps are operation-specific. The 22 source cases and 20 affected ordinary
metadata/Offer cases passed during implementation. Independent review found a
full-range EOF fixture inconsistency; the corrected case passed in 3.28s without
changing production validation. These tests use controlled source services.

The separate native composition test combines actual compiled Journal storage,
collected native files, the real source reader and authenticated loopback HTTP
with the generated runner client. It verifies exact source/closure, independent
bytes and SHA256 across 65536/65536/17-byte ranges, explicit nonempty and empty-file
EOF, and exclusion of private paths. Server shutdown precedes fixture cleanup.
The one test passed in 7.138s wall time; changed-file lint passed in 3.091s.
The stopped runtime evidence is synthetic; this test does not execute k6.

Bootstrap composition separately proves that startup supplies the actual Journal
and native reader to HTTP and drains service work before Journal shutdown.
Independent review covered the service, HTTP and bootstrap changes. Exact-source
worker checks were reused; component suites were not repeated for the composed test.
The mechanical type-module correction passed lint (0.90s), architecture checks
(1380 source files, 8.68s) and Node TypeScript (6.70s).

## Remaining work

The actual backend native gateway has separate component evidence; it is not part
of this generated-client composition test. Backend adoption, native publication,
result routes, source-free closure and agent publication ACK/deletion remain
required. No storage refund, terminal result, container qualification or native
architecture matrix is established by source HTTP alone.
