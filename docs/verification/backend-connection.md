# Private backend connection components

Status: independently reviewed components with local integrated checks. Executable
startup wiring, polling and dispatch remain pending; no release qualification.
Owning contract: [backend connection](../design/lld/backend-connection.md).

## Reviewed source

- Private configuration: `ab7d2115ae0afbd3d2cb38732e66d01c78e5587a`.
- Backend capacity source: `59f1300f1279c96b4cb829237caf7cfe81dd2a0e`.
- Runner gateway, including trailer correction:
  `b39e90f3f1a1efadc8bf81d7a32ec9fd5042f589`.
- Integration and recovery-fixture correction:
  `386f94c6233a73ccc21e1d4a93637f34f918f816`.

All three components received independent source review. Reviewers inspected actual
code, contracts and test assertions; they did not execute these tests or certify
runtime/release acceptance.

The loader captures private configuration/token files through bounded original
native operations, validates identities/profile/schema/storage policy, canonicalizes
safe HTTP origins and retains failed-close custody behind a permanent intake fence.
Only references to engine secrets are handled. Errors expose fixed messages.

The gateway uses generated runner clients/validators and Node HTTP. Two Offer and
eight ordinary original-call credits are shared across scoped facades. DNS, request,
response and socket work remain owned through cancellation/deadline/shutdown.
Framing/byte/header/fragment limits, expected scope/generation/intent checks and
no automatic mutation retry protect replies. Independent review found unchecked
chunked trailers; actual loopback tests reproduced acceptance before the fix.
Replies with any trailers now reject before JSON success, retaining close custody.

The source verifies a pinned backend data-root independently of agent staging.
It matches installed pins, controls, provenance and source/guard times; combines
configured backend allocation with its own bigint statfs totals/reserve; and keeps
an original aggregate lease <=1s from its oldest source. Repeated polls cannot
renew it. Unknown-period fences permit genuinely newer periodic recovery.
A reproduced future-timestamp poisoning defect was corrected before source review.

## Actual checks

Scoped component runs passed:117 configuration tests,79 capacity tests and43
runner tests. Tests use synthetic owned files, actual loopback endpoints and
controlled original-I/O seams; no real credentials or external daemon.

The initial combined scope had259 passes and one failure: a recovery fixture
could sample within the same clock millisecond as revocation. Production correctly
requires a strictly newer source. The fixture now waits at most100 real1ms timer
turns, asserts actual time advancement and samples normally; it creates no future
timestamp and changes no production code, assertion, input size or deadline.

At386f94c, the combined command selecting `app/test/runner`, private configuration,
capacity and storage runtime/lease tests with `--maxWorkers=1` exited0:
260 tests in12 files,6.86 seconds. Node TypeScript and lint exited0. Architecture
at the unchanged production source checked1,019 files; documentation checked161.

## Limits and next proof

The most recent full rewrite run remains the3208-pass/one-timeout result documented
in [capacity evidence](capacity-wire.md). These focused checks do not make it green.
The factories are not yet connected to executable application startup or its
SQLite capacity publication loop. Real startup/shutdown, stale publication across
the worker queue, dispatch/ACK recovery and result/artifact finalization still need
integration. No new Docker/native k6, amd64/arm64 image, resource, supply-chain or
release evidence is established by these component tests.
