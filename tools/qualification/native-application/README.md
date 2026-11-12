# Manual native application qualification

`smoke-app.ts` is an explicit developer qualification command. Unit tests never
start it. The coordinator supplies current locally built agent/k6 images and a
matching compiled metadata worker; this directory does not build images.

From the repository root, with installed dependencies and Docker permission:

```sh
node --import tsx tools/qualification/native-application/smoke-app.ts AGENT_IMAGE ENGINE_IMAGE 200 LOCAL_CONTEXT
node --import tsx tools/qualification/native-application/smoke-app.ts AGENT_IMAGE ENGINE_IMAGE 500 LOCAL_CONTEXT
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

Pure helper controls: `npx vitest run tools/qualification/native-application/helpers.test.ts`.

The separate source-free rejection command uses the same unchanged private
installation and public session/enqueue helpers:

```sh
node --import tsx tools/qualification/native-application/smoke-absence.ts AGENT_IMAGE ENGINE_IMAGE LOCAL_CONTEXT
```

Context defaults to `default`; compiled worker overrides above apply. After
configuring the original installation, this command lowers only the public
enqueue CPU budget to one below the actual manifest minimum. It requires the
agent's durable `below_manifest_minimum` rejection; earlier backend rejection
fails qualification. No capacity, proof, source or result is supplied by the
harness. Public reads must show errored/inconclusive, pending validation,
`budget_unavailable` and a null result.

After application close, independent bounded SQL checks compare the persisted
Offer, canonical absence proof/digest, physical Journal UUID, exact confirmed ACK
and event end (including zero), released execution credit and one absence receipt.
The charge oracle derives event bytes from actual canonical bodies plus row
allowance; this rejection must retain no provisional result, manifest, artifact
slots or source receipt. Original allocation stays unchanged and retained storage
must equal event bytes plus 65536. Public metadata reopen must preserve these
facts. Authenticated agent snapshot/absence/source routes are checked separately;
after clean agent stop, read-only Journal checks use the real loader's path and
require no reservation, collection intent or source. Both passes require zero
engine containers and target counts `0/0/0`.

Evidence records bounded source/compiled-worker fingerprints, immutable image IDs,
failure phase and exact-label cleanup. The command has not been Docker qualified
merely by passing helper tests, lint or TypeScript. It makes no browser, Compose,
native amd64 (unless actually recorded), soak or release claim.

Pure rejection controls:
`npx vitest run tools/qualification/native-application/absence-values.test.ts`.


## Mailbox transport component probe

Use a cached backend image containing Node24 and a fresh task-owned proof directory.
Bundle `mailbox-producer.ts` with esbuild (`--bundle --platform=node --format=esm
--target=node24`) to `producer.mjs` in that directory, then run:

```sh
node --import tsx tools/qualification/native-application/mailbox-archive.ts CACHED_IMAGE ABSOLUTE_PROOF_DIRECTORY ABSOLUTE_DOCKER_SOCKET
```

The command creates a uniquely labelled local-driver tmpfs volume and bounded,
networkless non-root container, checks the actual archive/envelope, probes after
stop, and removes only its matching fixtures. Container-local tmpfs is not
archive-readable. This is a synthetic mailbox transport proof, not a real k6 run,
active-plan authorization, complete live metrics, or cross-architecture evidence.

## Live producer qualification

After building current agent/k6 images and matched metadata/Journal workers, run
smoke-live.ts AGENT_IMAGE ENGINE_IMAGE complete LOCAL_CONTEXT, then cancel mode.
This explicit fixture uses one VU,20 iterations with500ms waits and a30s budget;
it requires two native producer revisions through authenticated public reads,
sealed completion or explicit unsealed cancellation, execution/output charge
checks, post-terminal unavailable
and exact task-owned volume cleanup. It does not run from unit tests.

The versioned baked image marker selects an installed live mailbox profile.
No suite/Offer field, image self-declared frame or browser selects its approval.
Live proof uses the same bounded two-network/control/runtime fixture, with at most
32 requests per target path. Only matching local128KiB/four-inode tmpfs volumes
are non-forcibly removed after owned containers are removed.
