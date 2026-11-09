# Application composition

`openApplication({externalOrigin,metadata,inputsDirectory?})` opens the real SQLite worker, strict
Fastify schema/error adapter, local session routes and guarded namespace/settings
plugins. It creates no listener and does not launch agents or engines.
Caller supplies compiled metadata worker URL, stable installation record and an
actual runtime observation or null. Unknown capacity remains unknown/503 for
settings resolution; `updateRuntime` accepts trusted source observations only.
Startup token is returned only for explicit local startup output, never HTTP.
Configured startup creates private durable input roots, the actual byte service,
guarded input routes and one pending-only recovery scheduler. Omitted input roots
disable these routes for existing composition tests; no fake byte service is used.
`close` retires session authority, starts HTTP/file drains together, then closes metadata,
and retains its original promise. Closing the returned server also closes storage.
Startup failure retires authority and awaits cleanup; no successful partial handle.
No generic service container, fake capacity or legacy app dependency is introduced.
`configuration.ts` reads <=32KiB of installation JSON from BEETLE_CONFIG_FILE,
rejects writable/symlink/nonregular config and requires an owned mode0700 data root.
BEETLE_EXTERNAL_ORIGIN is required; normal listener defaults127.0.0.1:4311.
`main.ts` prints the one-time token only after binding, handles INT/TERM, and
uses private umask. Explicit0.0.0.0 is for the private backend container network.
`npm run build:api` bundles main/worker separately; start:api runs that output.
`npm run smoke:api` needs an owned loopback port and tests the built entrypoint.
Run/artifact routes, agent dispatch and packaged proxy delivery remain work.
Check: npx vitest run app/test/bootstrap app/src/bootstrap/api.integration.test.ts --maxWorkers=1.
