# Local session adapter

Public entry: createLocalSession and captureLocalExternalOrigin in index.ts.
Contract: docs/design/lld/local-session.md. Programmatic default is paired;
normal executable selects automatic through bootstrap/local-access.
Exact canonical loopback Host/Origin, no forwarded trust/CORS; mutations require
CSRF except fixed JSON/custom-header pair/local exchanges. GET never grants access.
HttpOnly/SameSite Strict cookie,8h absolute session,5 exchanges/minute; bounded
headers/cookies/replies. Credentials never enter URLs/localStorage/public metadata.
Manual bootstrap15min/single use; automatic mode refuses pairing and prints no token.
AutomaticSessions owns at most one CAS/write original in private LocalSessionStore.
Unknown outcome fences auth until exact reconciliation; no waiting-write queue.
Restore retains only remaining lifetime; logout durably clears before ACK. Check
open authority in the HTTP continuation after awaits, immediately before replies.
Close fences late publication. No resources/schedulers/listeners/global guard/logs.
Composition passes authorize to every protected route and owns metadata drain.
Focused tests: app/src/adapters/inbound/http/session and app/test/local-session.
Real browser/proxy/image qualification remains separate from inject/TCP/jsdom.
