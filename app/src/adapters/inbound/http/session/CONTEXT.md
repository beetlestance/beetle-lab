# Local session adapter

Public entrypoint: `createLocalSession` in `index.ts`.
Inputs: canonical loopback external origin; optional trusted wall/monotonic clocks.
Outputs: startup-only bootstrap secret, synchronous-decision async Fastify
`authorize` hook, `registerRoutes(server)`, and idempotent `close()`.
Routes use shipped pairing/session/logout schemas and existing safe error mapping.
Composition installs schema compilers first and passes `authorize` to every
protected route plugin; this adapter does not install a global guard or listener.
Effects: only one in-memory bootstrap/session and fixed-size rate state.
Limits: 15-minute bootstrap, 8-hour absolute session, 5 attempts/60 seconds;
128 raw header pairs/16 KiB, 4 KiB cookie header/64 cookie pairs, 1 KiB replies.
Failures: fixed ApiFault codes; auth replies/errors and guarded replies no-store.
Invalid or rolled-back monotonic clocks and reentrant clock access fence authority.
Close revokes eligibility immediately; logout/expiry require a new backend instance.
No timers, resources, persistence, forwarding-header trust, logging, or CORS grants.
Owning contract: `docs/design/lld/local-session.md` (unchanged).
Focused checks: `NODE_OPTIONS=--max-old-space-size=1024 npx vitest run
app/src/adapters/inbound/http/session --maxWorkers=2`.
Operational proxy publication, startup secret output and browser UI are composed
separately and need packaged-install/browser evidence.
