# Automatic local session evidence

Status: locally verified source/default entrypoint; packaged browser pending.
Source: feature commit containing this report, based on8c7e659.
Contract: [local session](../design/lld/local-session.md); [decision015](../decisions/015-automatic-local-access.md).

## Behavior and ownership

Normal backend executable and rewrite Compose select automatic local access.
The UI reads an existing session, then uses a strict same-origin POST to open one.
No startup token is printed/pasted. Exact loopback Host/Origin, JSON/custom-header
exchange, no CORS and protected-write CSRF remain enforced. Paired mode is explicit
through BEETLE_LOCAL_ACCESS=paired; programmatic bootstrap defaults paired.

Migration014 adds one installation-private credential record to the existing
exclusive SQLite worker. No public metadata route exposes it. Requests/replies
are <=2KiB, record versions monotonic and exact one-step CAS replay is idempotent.
Restore retains only remaining8h lifetime. Logout writes null before its receipt;
unknown writes retain the original and fence authorization until reconciliation.
Only one auth write can be active; there is no waiting-write queue. Credentials
never enter URLs, localStorage, normal startup output or public diagnostics.

## Local checks

HTTP cases cover automatic grant/reuse, cookie flags, restart value restoration,
CSRF, malformed body, absent/foreign/duplicate headers, CORS refusal, explicit paired
refusal, lost credential-write/logout replies, remaining lifetime/expiry renewal,
concurrent write admission and close fencing. Twenty-one existing paired/guard
cases passed with the first four automatic cases. Eight final automatic cases
passed after the lifecycle correction, including two publication regressions.

Independent review found a microtask gap after grant/logout's final owner check
and before the HTTP handler resumed. Both regressions reproduced late200 success
before correction. HTTP continuations now recheck open authority immediately before
synchronous reply publication. An unknown auth write503 can be reconciled through
explicit local reconnect, without replaying resource writes or showing a token form.

Actual compiled-worker tests prove persistent record/reopen, lost-write replay,
changed/stale refusal and durable logout. Codec cases reject malformed/oversized
values, substituted reply secrets and accessors. An initial negative-zero test
exposed JSON normalization; raw numeric descriptors are checked before encoding.

Actual TCP and the compiled metadata worker passed grant, protected read, backend
close/reopen with the exact original cookie/expiry, logout, another reopen refusing
that cookie, and a fresh grant. The first socket attempt was sandbox-denied; the
same isolated test passed with normal ephemeral-loopback approval in8,640ms.
Remote external origin was separately refused before metadata-file creation.

The compiled default main passed token-free startup, namespace/full-size suite and
input authoring, unavailable-run/scoped reads, logout and clean SIGTERM in2,577ms.
Explicit paired bootstrap/input profiles passed in9,571ms. These are task-owned
synthetic services, not changes to an existing installation or a real k6 workload.
Fifty-seven generated-session/client binding cases passed in1,581ms.

Browser component cases exercise automatic opening before resource queries, strict
protocol headers, paired-only fallback, lost-reply recovery, explicit reconnect
following logout/pending persistence and epoch ownership. Existing paired/transfer
cases passed alongside the new cases. One initial assertion incorrectly assumed
localStorage was empty despite the legitimate theme preference; the corrected
oracle checks credential absence. No auth boundary or production gate was weakened.

Node/web types, changed lint, architecture, authored docs, API generation drift and
actual backend/worker/client bundle passed in scoped commands. Architecture caught
value types initially importing an outer port; types now belong to the domain and
the port reexports them. Full command/exit/timing evidence stays with the packet.

## Limits

No real-browser tool was available. Inject/TCP/jsdom and compiled main do not prove
browser cookie/proxy behavior in the final image. Compose configuration is checked
separately; no new Docker image, published pull install, native architecture matrix,
LAN/hosted authorization or whole-release qualification is claimed. Existing user
services/data were not restarted or modified. The standalone-export job and normal
one-command Compose provisioning remain separate unfinished work.
