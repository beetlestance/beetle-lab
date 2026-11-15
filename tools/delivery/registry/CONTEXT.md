# Qualified registry delivery

`plan.ts` imports twelve checked configs by OCI digest and creates six two-platform
indexes. Tags include source SHA and qualifying run ID. `value.ts` validates the
closed public plan; private layouts, auth/config files and logs are never uploaded.
`tool.ts` verifies pinned regctl and owns its empty or explicit CI credentials.

`publish.ts` requires the owned manual CI context and fresh successful source-run
validation. `releases.ts` refuses tag/asset conflicts. `public-sources.ts` publishes
and anonymously hashes sources before `remote.ts` writes any image. Remote copies
preserve digests; existing conflicting tags fail closed. Only complete readback
produces installation references. Owned writers are serialized; external registry
administrators can still move tags, so installations use immutable digests.

`pull.ts` proves all six anonymous pulls in a fresh private Linux vfs store.
`native.ts` independently pulls with empty credentials and runs the native Compose
acceptance against the candidate's identical Compose file. Closed qualification
records bind both platforms to configs/indexes and verified fixture cleanup.
`complete.ts` publishes the separate installation release only after both native
records and anonymous remote readback. Never add assets to the source release
after publishing it. See README.md and docs/verification/rewrite-image-delivery.md.

`local.ts` uses an existing local gh session explicitly; never emulate CI variables.
Sources are public before CI writes images. Optional local-releases workflow mode
skips only installer-release publication, preserving both anonymous native gates.
`delivery-run.ts` binds local finalization to the owned successful first manual run,
three required gates and immutable ZIP IDs/digests; normal source gates stay intact.

Failed pulled execution retains only a reprojected `native-failure.json` and fixed
phase/producer code; raw errors/logs remain private. A diagnostic is not qualification.
