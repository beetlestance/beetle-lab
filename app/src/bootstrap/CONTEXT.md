# Application composition

`openApplication({externalOrigin,metadata})` opens the real SQLite worker, strict
Fastify schema/error adapter, local session routes and guarded namespace/settings
plugins. It creates no listener and does not launch agents or engines.
Caller supplies compiled metadata worker URL, stable installation record and an
actual runtime observation or null. Unknown capacity remains unknown/503 for
settings resolution; `updateRuntime` accepts trusted source observations only.
Startup token is returned only for explicit local startup output, never HTTP.
`close` synchronously retires session authority, closes HTTP then metadata worker,
and retains its original promise. Closing the returned server also closes storage.
Startup failure retires authority and awaits cleanup; no successful partial handle.
No generic service container, fake capacity or legacy app dependency is introduced.
Suite/run/artifact routes, listener/config loading, agent dispatch and packaged
proxy/startup delivery are still separate work.
Check: npx vitest run app/src/bootstrap/api.integration.test.ts --maxWorkers=2.
