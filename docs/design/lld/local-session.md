# Local browser session

Status: selected contract; guard, routes and browser handshake pending.
Owner: app HTTP session adapter; composition provides startup token output and
external origin. This is a single local administrator, not hosted IAM.

## Exchange

Generated API contracts own JSON. `POST /api/v2/auth/pair` accepts only
`bootstrapToken`; `GET /api/v2/auth/session` recovers the current session. Both
return scope `local-admin`, UTC `expiresAt` and `csrfToken`. Session identity is
only an HttpOnly cookie, never JSON. `POST /api/v2/auth/logout` accepts `{}` and
returns `loggedOut: true` after revoking it. All replies and errors are no-store.
No long-lived credential goes in a URL, localStorage, diagnostics or committed file.

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
