# Local browser session

Status: paired and automatic persistent profiles locally verified; packaged browser
qualification remains pending.
Owner: app HTTP session adapter; composition supplies external origin and the
private metadata store (or paired-profile startup token output). This is a single local administrator, not hosted IAM.

## Paired profile (advanced)

Generated API contracts own JSON. `POST /api/v2/auth/pair` accepts only
`bootstrapToken`; `GET /api/v2/auth/session` recovers the current session. Both
return scope `local-admin`, UTC `expiresAt` and `csrfToken`. Session identity is
only an HttpOnly cookie, never JSON. `POST /api/v2/auth/logout` accepts `{}` and
returns `loggedOut: true` after revoking it. All replies and errors are no-store.
No credential goes in a URL, localStorage, diagnostics or committed source. The
automatic profile persists its bounded private record in installation metadata.

Generate independent 32-byte cryptographic bootstrap/session/CSRF values, encoded
as 43-character base64url. Store one session in memory; consume the bootstrap
atomically on successful pairing. Its lifetime is 15 minutes, session lifetime
8 hours, both absolute and bounded by monotonic time. Wall time formats expiry;
invalid clocks fence authorization. Restart invalidates the session and issues a
fresh bootstrap token through explicit local startup output. Logout/expiry requires
restart to pair again in this first profile; no token recovery endpoint is exposed.

Cookie `beetle_session` is HttpOnly, SameSite=Strict, Path=/api/v2/, Max-Age=28800,
without Domain; HTTPS adds Secure. Logout clears the same cookie attributes.
Use fixed-length checks and constant-time secret comparison. Retain no unbounded
session/rate map. Pair admission permits five attempts per 60 seconds globally,
after origin checks; exhaustion is fixed `429 rate_limited`. Invalid, consumed or
expired tokens all yield `401 unpaired`. Origin/session-CSRF denial is `403 forbidden`.

## Request guard

Configure one exact loopback frontend origin at startup; reject credentials,
non-root path, query, fragment and non-loopback hosts. The frontend publishes on
loopback and proxies privately to backend, preserving incoming Host. Ignore
forwarded headers. Reject duplicate, malformed or nonmatching Host/Origin headers.
Check Host, then any present Origin, then session, before body parsing or effects.
GET/HEAD reads may omit Origin; mutations require exact Origin and
`X-Beetle-CSRF`. Pairing alone omits session/CSRF but requires exact Origin,
JSON content type and `X-Beetle-Pair: 1`, with rate admission before body parsing.
No CORS grant. Bootstrap must install this guard on every protected route.

The UI reads session before mounting resource queries and keeps CSRF only in
memory, injected into the existing typed client. Unknown pairing outcome first
checks session; it never automatically resends the one-time token. Resource 401
clears session/cache and presents pairing. Existing mutation uncertainty stays
explicit; changing session does not imply an unacknowledged write failed.

## Verification

Exercise Host/Origin/CSRF rejection before parsing/store calls, duplicate headers,
concurrent token consumption, restart/expiry/clock changes, rate bounds, cookie
flags/revocation and safe no-store errors through actual Fastify. Test UI reload,
logout and lost pairing reply. Loopback publication/proxy, browser cookies and
restart token delivery need actual packaged-install evidence separately.

## Automatic local profile

User-selected normal executable profile is automatic, with the same exact loopback
frontend origin and loopback-only published Compose port. Explicit paired profile
remains available for developer/automation workflows. Neither profile grants LAN
or hosted access. Automatic local access trusts people/processes on that local box.

POST /api/v2/auth/local accepts only {} and X-Beetle-Local:1, exact Origin/Host and
JSON content type. A GET never grants a session. Foreign origins, duplicate headers,
cross-site requests and malformed bodies are rejected before persistence/effects.
No CORS or forwarded-host trust. Reply adds accessMode:automatic; cookie and protected-route CSRF checks
remain identical. Absent accessMode denotes the paired profile. Only paired-profile refusal returns401; fenced/closed automatic authority returns503.
Paired profile refuses this exchange; automatic profile refuses
bootstrap pairing. Normal automatic startup never prints a pairing token.

Persist one private session (cookie secret, CSRF token, issued/expiry UTC) through
the existing exclusive metadata worker, with a monotonic record version and <=2KiB
request/reply. Session absolute lifetime stays8h; cookie Max-Age stays28,800seconds.
Reopen restores only the remaining lifetime; it never extends an old credential.
Expired sessions renew through the automatic POST without a manual token/restart.
Future issued times, invalid clocks or malformed persistent state fence startup.
No credential is exposed through ordinary public metadata/result routes.

One pending auth write, no waiting-write queue. CAS with exact one-step replay
recovers lost replies; while outcome is unknown protected authorization is fenced
until the same original write is reconciled. New grant and logout replies require
confirmed persistence; logout clears the stored session before clearing the cookie.
Close denies late grant publication. Normal reads perform no session database IO.

Browser first reads an existing session, then attempts automatic local exchange on
401 or an explicit storage_unavailable503 that may represent a pending auth write. Only explicit paired-profile401 falls back to the token form. Unknown exchange
outcome first checks the cookie/session. Logout stays signed out until an explicit
reconnect/reload; resource401 retires its epoch and never replays user mutations.
