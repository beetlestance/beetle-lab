# Installed execution binding

Status: locally verified at runtime source `63d27836c9edb2d61552cbed965e0e603339e117`.
The application dispatcher, fresh capacity bridge and complete result path remain
required. This evidence does not qualify a release or current container images.
The [owning contract](../design/lld/installed-identity.md) defines the binding.

## Implemented boundary

Every new Offer requires manifestId, profileId, catalogVersion and the exact
manifest/profile/schema digests. The agent derives content hashes from its actual
captured descriptors. Catalogue and Stager compare the whole tuple before new
acceptance or preparation. Capability entries advertise the tuple and config version;
private profile paths and resolved credentials are excluded.

Application private pins carry that same tuple. Immutable Offer bytes and intent
cover it; a browser profile name remains a separate alias. An original request
receipt replays before current registry/settings/capacity reads. No applied database
migration or old durable Offer is rewritten.

Identical accepted scoped Offers replay before current catalogue checks; changed
contents conflict. Existing-row scope checks precede conflict details. Recovery
returns `installed_identity` for missing or changed bindings before new reservation
or preparation. Old snapshots and charges remain available. An owned controller
continues settling its original plan; a cached plan without a controller must
revalidate. Shutdown may abort an unstarted charge only after this manager received
its successful original admission; inherited or uncertain charges stay retained.

Shared bounded canonical JSON preserves previous journal, mutation and result-seal
preimages. Object keys, including numeric keys, use lexical ordering; arrays keep
their order. Golden seal and independent SHA256 vectors cover compatibility.

## Failure and integration oracles

- Catalogue and Stager reject every tuple field and changed manifest/profile
  semantics under an unchanged engine selector. The wrapper independently checks
  manifest content; private profile/schema attestation stays agent-owned. These
  checks precede provider, dataset, secret or compiler effects. Raw staged-file
  hashes remain separate.
- Real SQLite persistence and a bounded agent-owned child process exercise the
  actual catalogue: original Offer accepts, changed profile rejects, and reopening
  metadata with changed pins preserves the original receipt, Offer and one outbox.
- Queued, charged and claimed records with old bindings remain unchanged through
  reconciliation and shutdown. A shutdown race during initial read or queue-full
  deferral was reproduced before correction. Delayed successful admission still
  cleans up once; an unknown original reply retains its committed charge.
- Full-size config/Offer propagation remains covered. Valid fixture installation
  changes explicitly derive replacement bindings; tamper fixtures never refresh
  their binding automatically. Existing limits, timeouts and assertions are intact.

## Commands and limits

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0: **3,160 tests
in314 files, 374.71s**. Contract/API/compiler generation, all three TypeScript
projects, lint, architecture977, docs154 and frontend build passed. The existing
frontend chunk warning remains (609.69kB); no gate was lowered.

The preceding full run at `209095c` exited1 with29 failures in attempt fixtures
that changed manifests without replacing their bindings. The correction passed
56 focused tests and independent source review before the full run above. An
earlier architecture failure was corrected by using a process boundary in the
cross-service test; the architecture rule stayed enforced.

`build:api`, `build:agent` and `build:k6` each exited0, targeting Node24.
`smoke:api`, `smoke:agent` and `smoke:input-controls` exited0 with compiled processes,
synthetic loopback/Unix fixtures, authentication, replay and shutdown checks.
Execution host: Node26.7/macOS arm64. The daemon in the agent smoke is a fixture.

The normal backend still refuses new enqueue503 without its genuine private
registry/capacity bridge. No current real Docker/native-k6 execution, amd64 matrix,
resource/soak, browser proxy or release qualification is inferred from these checks.
The native Docker fixture now derives matching actual descriptor pins, but needs
new images and its own qualification run. Capacity freshness, delivery/ACK/cancel,
event/seal/artifact finalization and run/results UI remain pending.
