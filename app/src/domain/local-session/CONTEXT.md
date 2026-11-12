# Private session value

Public entry: captureStoredSession/captureSessionRecord in index.ts.
Port: app/src/ports/local-session.ts; owner docs/design/lld/local-session.md.
Closed JSON snapshots, fixed43-character secrets, distinct cookie/CSRF,
canonical UTC and exactly8h absolute lifetime; safe monotonic record versions.
No authorization, clock, SQL, transport, logging or side effects.
Bound record2KiB/session1KiB. SQLite and HTTP session owner consume this boundary.
Focused tests: app/test/local-session/worker.test.ts and HTTP/session/automatic.test.ts.
