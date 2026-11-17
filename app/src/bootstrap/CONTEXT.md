# Application composition

`openApplication({externalOrigin,metadata,inputsDirectory?,agent?})` opens the real SQLite worker, strict
Fastify schema/error adapter, local session routes and guarded namespace/settings
plugins. It creates no listener and does not launch agents or engines.
Caller supplies compiled metadata worker URL, stable installation record and an
actual runtime observation or null. Unknown capacity remains unknown/503 for
settings resolution; `updateRuntime` accepts trusted source observations only.
Startup token is returned only for explicit local startup output, never HTTP.
Configured startup creates private durable input roots, the actual byte service,
guarded input routes and one pending-only recovery scheduler. Omitted input roots
disable these routes for existing composition tests; no fake byte service is used.
Root initialization is serialized per process. Unknown directory close retains
its handle and pending startup; subsequent initialization is fenced, without retry.
`close` retires session authority, drains HTTP/agent/file originals before metadata,
and retains its original promise. Closing the returned server also closes storage.
Startup failure retires authority and awaits cleanup; no successful partial handle.
No generic service container, fake capacity or legacy app dependency is introduced.
`configuration.ts` reads settings plus required BEETLE_AGENT_CONFIG_FILE and its private token;
it requires a canonical owned mode 0700 data root and validated installed-profile pins.
BEETLE_EXTERNAL_ORIGIN is required; normal listener defaults127.0.0.1:4311.
`main.ts` prints the one-time token only after binding, handles INT/TERM, and
uses private umask. Explicit0.0.0.0 is for the private backend container network.
`npm run build:api` bundles main/worker separately; start:api runs that output.
`npm run smoke:api` needs an owned loopback port and tests the built entrypoint.
Startup/shutdown diagnostics emit at most four allow-listed cause codes; no error
text, stack, paths or configuration values enter these records.
Check: npx vitest run app/test/bootstrap app/src/bootstrap/api.integration.test.ts --maxWorkers=1.

`runtime-poller.ts` owns one sample/publication at a time and coalesces unknown
periods; `runtime-publication.ts` preserves explicit SQLite refusal versus failure.
`agent-runtime.ts` and `agent-owners.ts` wire one shared gateway, capacity and
automatic delivery. Fatal errors fence work; shutdown owns both loop originals
before the gateway and metadata. `cleanupState` gives retention its advisory
driverState from in-memory loop/failure flags: `running` means only loop availability,
not agent reachability, batch progress or funding; it names no refusal cause and no
failure cause survives a restart. Contract:
[Runtime polling](../../../docs/system/contracts/run-delivery.md#agent-scheduling-and-capacity-polling).
