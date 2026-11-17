# Bounded packaged full-storage case

run.ts accepts verified native source bundle/output/local Docker context. It never
builds/pulls images, runs an engine or selects a user installation. Public packaged
provisioner/backend serve a fresh synthetic installation in a 64 MiB local tmpfs
volume. Only advanced free-space reserve becomes0 before provisioning; factory
policy, attempt caps/pools and production code remain unchanged. Require1.5 GiB
VM available memory first; filler memory is bounded64KiB, actual writes<=64 MiB.

The filler must observe real ENOSPC and validate native tmpfs type/size. Public
HTTP input append must refuse full storage with unchanged staging prefix/offset;
after freeing only the owned filler, resume/seal/download must hash-match. Explicit
deletion under full storage may complete or remain pending/refused, then the same
intent is replayed after space is freed and the owned backend is restarted. Deleted input records remain tombstones; content returns HTTP409. Verify both
staged/published native files are absent after authoritative deleted state.
All byte-client originals drain before teardown; no mutation is silently retried.

Owner and exact volume plan precede effects. Independent cleanup.ts OUTPUT CONTEXT
validates owner/source labels and exact tmpfs options before removing containers,
network and volume. No bind of the host data filesystem, prune or global fill.
Outer 600 s; individual Docker originals60s, cleanup120s result deadline. Raw logs,
policy/IDs/errors stay private. This does not prove every publication/deletion
crash point, power-loss behavior or an underlying write ENOSPC when statfs refused
first. Preserve actual failure branch rather than inferring a stronger claim.

An owner-labelled capped keeper mounts tmpfs before its first write and remains
through all helpers/backend reads; otherwise a last unmount loses tmpfs data.
Keeper lifetime660s covers the600s result window; success checks it still runs.

The backend-only case has no capacity-producing agent; getInstallationSettings
therefore remains unavailable. Session/namespace/input routes are exercised
without that unrelated runtime-settings readiness prerequisite.

Full-disk metadata reads may return503. Keep that state unknown; do not infer
deletion/refund. Recovery requires freeing space and restarting the owned backend.
