# Manual native application qualification

`smoke-app.ts` is an explicit developer qualification command. Unit tests never
start it. The coordinator supplies current locally built agent/k6 images and a
matching compiled metadata worker; this directory does not build images.

From the repository root, with installed dependencies and Docker permission:

```sh
node --import tsx app/test/container/smoke-app.ts AGENT_IMAGE ENGINE_IMAGE 200 LOCAL_CONTEXT
node --import tsx app/test/container/smoke-app.ts AGENT_IMAGE ENGINE_IMAGE 500 LOCAL_CONTEXT
```

The optional status defaults to200 and context to`default`. A context must resolve
to a local Unix socket. Images must already exist and match the Linux daemon's
amd64/arm64 architecture. The worker defaults to`app/dist/worker.js`;
`BEETLE_METADATA_WORKER_FILE` selects another matched compiled worker.
Fresh initialization also requires the matched compiled agent journal worker,
defaulting to`agent/dist/worker.js`; `BEETLE_AGENT_WORKER_FILE` selects its path.

The fixture creates synthetic credentials/settings, a private backend root, an
internal target network for engine/target and a separate owned control bridge for
the agent's dynamic loopback publication. Both networks have the exact task label;
cleanup allows at most two. Agent/target containers are capped; the application
also uses a dynamic loopback port. The real application loads private configuration and derives
capacity from its normal agent/backend sources. A paired public API session saves
a namespace/workspace/suite/revision, enqueues once, and reads the terminal result.
Only the agent dispatch path starts k6. Work is one VU/iteration plus one readiness
request, with a30s/16MiB execution profile. Requests, replies, polling, logs and
artifact verification reads have explicit limits; mutations are never retried.
Before starting the agent, the fixture explicitly creates its real journal and
ready installation gate using the configured journal path and durable authority,
closes the initialization handles, and verifies private file ownership/permissions.

After the application closes, bounded read-only SQLite checks verify its actual
Offer, source/receipt/event closure, published bytes/hashes and independent storage
credit. A metadata reopen must preserve public run/result reads and accounting.
Actual agent snapshot, stopped engine controls/seal/artifacts, released reservation
and exactly one target work request are checked separately. Cleanup uses the
existing bounded exact-label Docker owner and retains private evidence locally.
Exit0 means every check, including current resource absence, passed.

This is host-backend functional evidence. Record host Node/OS separately from the
images' Node/Linux environment. It does not qualify a shipped backend container,
browser, Compose, crash recovery during execution, resource abuse or a release.
Unknown Docker work remains a failed qualification even if cleanup currently sees
no resources; inventory cannot prove absence of a delayed create.

Pure helper controls: `npx vitest run app/test/container/helpers.test.ts`.
