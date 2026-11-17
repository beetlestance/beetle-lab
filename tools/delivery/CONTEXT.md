# Candidate delivery

`identity.ts` binds six immutable image IDs to clean native execution and scans.
Tags and revision labels alone never establish execution.

`archive.ts` saves exactly qualified image IDs without rebuilding or registry
access. JSON leaves, archives, commands and streamed reads/hashes stay bounded.
`producer.ts` counts output before writing, stops its owned POSIX process group
on overflow/deadline, escalates TERM to KILL and joins actual close. Stderr is
bounded without retaining its content. Both tar and compressed streams are capped;
peak partial payload is <=6 GiB plus bounded metadata/filesystem overhead.
It publishes a versioned bundle only after successful save/compression/hash.
Partial outputs are private and cannot authorize publication. Existing output
directories are refused. Credentials and installation files never enter bundles.

`scripts/rewrite-supply-chain.sh` retains separate vulnerability and license
inventories, image CycloneDX reports and source dependency inventory/audit. It fails
HIGH/CRITICAL CVEs, including unfixed findings, and fails closed on scanner errors.
`scripts/install-ci-trivy.sh` pins official Trivy archive checksums for native Linux.

Publication gates: [release approval](../../docs/release-approval.md).

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

`authority.ts` requires configured beetle-release reviewers and exactly the
integration branch deployment rule. A read-only job checks this before either
write job can enter the environment's GitHub approval gate; missing policy refuses.
