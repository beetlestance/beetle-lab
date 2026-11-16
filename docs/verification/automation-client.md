# Automation client evidence

Status: locally verified source/client bundle; container qualification pending.
Source: the feature commit containing this report, based on acff6b5.
Owner: app/src/client/cli. No backend authentication, API schema, storage, engine,
dependency or execution-budget change. build-api adds the optional automation entry.
The existing backend image recipe copies that output without a new runtime service.

## Exercised behavior

The optional client consumes the existing startup token for one fresh CI session,
stores only validated credentials in an exclusive private file, and sends the
existing Host/Origin/cookie/CSRF authority on generated API operations. The session
file binds exact endpoint/origin, owner,0600 mode, regular single-link identity,
size and valid expiry. Input/output file limits and stable reads are enforced.
No credentials, raw errors or config values are printed as diagnostics.

Commands run/status/result/cancel/compare use the existing typed API. Run/cancel
issue once with the supplied requestId; explicit same-file replay is supported,
automatic mutation retry is absent. Waiting retains one sequential read, monotonic
deadline,2s cadence and at most1,801 reads. Post-reply checks reject late terminal
success, including mutation replay before an abort timer callback runs. Outcomes
come from application Run facts; submitted/pending/null result remain distinct.

## Local checks

The scoped runner preserves original failures and actual command/exits/times.
Focused unit cases cover closed argv/URLs, malformed/oversized/scoped requests,
case-folded duplicate/five-run comparison, restricted files, exclusive preservation,
wrong/expired credentials and cookie provenance, no retries, declared outcome exits,
held late replies, stalled clocks and output error/close ordering.

Actual composed Application, SQLite worker and loopback TCP exercised pairing,
namespace/suite/revision setup through authenticated API, enqueue, pending status,
unsent cancellation, null result, one lost enqueue reply, explicit replay, exactly
two durable runs and provenance comparison. This test passed in4,118ms. No frontend,
agent process, engine container, target traffic or real credentials were used.
The separate Host/redirect/held-body abort test passed in714ms. The adapter uses a
byte-sized64KiB response queue under the existing wire JSON limits. TLS/native
container behavior is not established by this HTTP fixture.

Changed-source lint, Node types, architecture and docs are required before merge.
The backend bundle includes automation.js and its independent process entrypoint
returns invalid-input exit2 with exactly one fixed JSON diagnostic. Packaging
checks do not establish a built/published/pulled container image or CI installation.

## Corrections and limits

Initial negative argv rows were spread by the test framework rather than passed
as arrays; the fixture invocation was corrected. Sandbox denied loopback bind;
normal approval escalation enabled only the isolated synthetic listener. Native
Node fetch then replaced an explicit Host header, correctly producing forbidden
under the existing session guard. A minimal independent loopback check reproduced
that behavior. The closed Node HTTP(S) adapter preserves Host; the guard was not
weakened. Source/body guards were split by responsibility to satisfy complexity.

Independent read-only review found late-reply deadline and callback-before-error
stdout gaps; typed held replies, unfired timers, failed Writable callbacks and
blocked-output abort tests cover the fixes. Later monotonic mutation checks retain
unknown-outcome/requestId semantics. Preflight destination refusal avoids consuming
a startup token for a known existing file. A destination introduced during pairing
is preserved and the write fails with IO exit3; no second exchange occurs.

Each request file is <=4KiB, credential file <=4KiB, token <=64bytes and output
<=1MiB. HTTP/wait has a finite deadline; native filesystem originals drain before
returning. Stdio has a separate1s budget and retains error ownership through close.
The generated transport may return before an ignored injected fetch settles; the
owned Node HTTP adapter cooperatively aborts its request/body. There is no daemon,
result cache, event corpus, engine retry or implicit run cancellation.

Fresh CI pairing still needs a trusted startup-token file. Existing browser
installations cannot pair again; local automatic access remains a separate pending
change. Validate/script-export commands require their admitted APIs. Retention,
release image qualification and the later UI redesign remain separate work.
