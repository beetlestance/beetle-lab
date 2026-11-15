# Candidate delivery

`identity.ts` validates bounded parsed metadata and binds exactly six immutable
Docker image IDs to a passed/clean native outcome and the image scan identities.
No tag or revision label alone establishes that the image was executed.

`archive.ts` is an explicit CLI: revision, architecture, absolute scan directory,
absolute outcome JSON, new absolute output directory. It saves those IDs without
rebuilding or registry access. JSON leaves are <=256KiB, single-link regular files;
archives are <=3GiB, commands <=120s, reads/hashes are bounded/streaming.
`producer.ts` counts output before writing, stops its owned POSIX process group
on overflow/deadline, escalates TERM to KILL and joins actual close. Stderr is
bounded without retaining its content. Both tar and compressed streams are capped;
peak partial payload is <=6GiB plus bounded metadata/filesystem overhead.
It publishes a versioned bundle only after successful save/compression/hash.
Partial outputs are private and cannot authorize publication. Existing output
directories are refused. Credentials and installation files never enter bundles.

`scripts/rewrite-supply-chain.sh` retains separate vulnerability and license
inventories, image CycloneDX reports and source dependency inventory/audit. It fails
HIGH/CRITICAL CVEs, including unfixed findings, and fails closed on scanner errors.
`scripts/install-ci-trivy.sh` pins official Trivy archive checksums for native Linux.

Registry publication, anonymous complete pulls and matched Compose installation
require their own accepted evidence. Transport is not a release gate waiver.

`references.ts` owns six nonce transport tags and binding-checked cleanup.
`contents.ts` verifies role/config/manifest hash bindings; `bundle.ts` captures the
closed v2 transfer record. Source image IDs, config digests and registry digests
are distinct. `roundtrip.ts` requires the fresh private Linux vfs store created by
`scripts/verify-rewrite-archive.sh`, imports, reexports and checks all six configs.
Source stores are never pruned; raw daemon logs remain private.

`trust.ts` requires the successful first manual CI attempt on rewrite/integration,
all twelve source/unit/native/aggregate jobs and eight immutable run-bound ZIP
identities. `github.ts` reads four fixed authenticated API paths, joins issued
requests and refuses incomplete lists. `download.ts` verifies exact ZIP size/hash.
`stage.ts` streams bounded whitelisted leaves; `staged.ts` matches both platforms
against native/scan/bundle/restoration/config identities and archive hashes.
Sources: sources/README.md; qualified publication/native installs: registry/README.md.
