# Qualified image transport

Scope: preserve and deliver exact tested/scanned candidates. The accepted
publication and installation results are recorded separately below.

## Authority and bounds

Optional CI input `prepare_rewrite_delivery` defaults false and grants no registry
permissions. After successful native qualification and scans, the job requires one
closed passed/clean outcome, matching revision/architecture and exactly six scan
identities. Every Docker image ID must match both execution and scan evidence.
Six unpredictable local transport names are bound to those exact IDs before and
after save. They are never registry targets. Existing names are refused; cleanup
checks current bindings and preserves a last source name. No image is rebuilt.

The archive command uses the explicit local default Docker context. Metadata is
bounded to 256KiB regular single-link files; symlinks and FIFOs are refused. Tar
and gzip producers each have a 3GiB active output ceiling and a 120-second deadline.
Counted streams reject excess bytes before writing, stop their own POSIX process
group, escalate TERM to KILL and join the original close before returning failure.
Stderr is counted without retaining its content. Peak partial payload is at most
6GiB plus bounded metadata/filesystem overhead. Existing outputs are never replaced.

Only complete compression/hash produces `bundle.json`; partial files cannot grant
publication authority. CI retains the bundle and compressed images for one day,
excluding source installation data, credentials, logs and caches. An artifact can
be preserved while independent unit shards finish; it does not waive their gate.

## Archive identity and restoration

Bundle v2 records source Docker IDs, six transport references and six config
digests separately. They are not registry manifest/index digests. The archive
requires six Docker entries and six OCI manifests; config/manifest hashes, role
bindings, revision and platform are verified before accepting it.

Native CI restores the bundle into a new private Linux vfs daemon with an empty
store, private socket/data/exec roots, networking disabled and bounded lifetime,
CPU, memory and process count. It verifies all six references/config IDs, reexports
and rechecks their exact config bytes, then stops the owned daemon group. The
source daemon is never pruned or selected by this verifier. Hosted ARM64 run `43656926824` passed this restoration gate. Both native
jobs in run `43663602569` also passed, along with all six unit shards and both
aggregate gates.

Source Docker IDs can be config or manifest digests depending on the store. The
classic vfs round trip checks canonical config IDs; the outcome records both source
and restored IDs explicitly. A registry publisher must verify its own manifests.

## Actual local proof

The corrected producer archived the six unchanged, scanned de4f908 ARM64 images
from the accepted normal Compose result: 107,069,440 raw tar bytes and 106,588,791
compressed bytes. The compressed SHA256 and role bindings are retained privately.
All six OCI index descriptor IDs and their manifest/config hash chains matched the
tested identities, Linux/arm64 and source revision. That proof did not load the
archive and does not establish restoration.
This Docker containerd store reports OCI manifest IDs; those are distinct from
config digests. A first proof probe incorrectly equated them and was not accepted.
Registry delivery must respect that distinction and verify content after transfer.

Thirteen identity/file cases passed, plus five producer cases covering active flood
limits, ignored TERM/deadline escalation, actual process exit, exclusive output,
partial failure and bounded private stderr. Types, lint, architecture, docs and
actionlint passed. Review caught post-write-only limits; counted producers replaced
them before integration. The earlier unbounded-output proof is not accepted evidence.

A hosted f111105 archive exposed a concrete defect: its legacy manifest listed
six images but its OCI index named only one. Docker load exited successfully while
registering only the installer. Earlier checksum-only proofs remain incomplete.
The corrected local tagged archive contains six verified roles and config bindings;
its isolated-store restoration passed on hosted ARM64. The matching archive
was loaded on Docker Desktop, then all six configurations were reexported and
checked against their canonical hashes. Manifest IDs differed from classic
Docker config IDs as expected. No registry write occurred.

Anonymous registry pulls and [remaining release blockers](qualification-blockers.md)
still require their own results. Existing legacy publication and default tags remain
unchanged; this packet does not publish images or a release.

## Trusted run selection

Delivery tooling reads four fixed authenticated GitHub API paths. It requires
a completed successful first manual CI attempt on `rewrite/integration`, the
exact repository/workflow/full revision, all twelve source/unit/native/aggregate
jobs, and eight unique unexpired run-bound artifact IDs and SHA256 ZIP digests.
Incomplete paginated lists, duplicate gates and skipped required jobs fail closed.

Downloads select immutable IDs, use exclusive files and count bytes through the
existing bounded process owner. The ZIP envelope ceiling is 3GiB plus 1MiB; inner
archive creation and verification remain capped at 3GiB. Exact ZIP size/hash is
checked before later processing. ZIP, inner gzip, config and manifest identities
are distinct. Selection does not establish inner content or registry acceptance.

The reader accepted fully green hosted run `43663602569` at `ec080760` and selected
eight artifacts. An actual native AMD64 outcome ZIP (676 bytes) matched its
GitHub artifact SHA256. No registry write occurred.

## Bounded staging

`tools/delivery/stage.ts RUN_ID FULL_SHA NEW_ABSOLUTE_DIRECTORY` revalidates the
qualified run and downloads its immutable ZIP IDs. It checks ZIP hashes before
listing exact permitted members. `unzip -p` streams only those members into
independently chosen exclusive regular files; archive paths and symlink metadata
are never restored. Reports have per-file bounds and a 50MiB aggregate ceiling.

For each platform, the staged bundle must match all six native/scanned IDs and
the successful isolated-store proof, including exact config identities and gzip
hash. Bounded decompression verifies declared tar size and all six config/manifest
hash chains. Only success for both platforms writes `staged.json`. Partial files
remain private and cannot authorize publication. No Docker load, rebuild or
registry write occurs in this step.

Actual staging of run `43663602569` completed for AMD64 and ARM64: all eight ZIP
digests, both inner archives and both six-image identity chains passed. The
private complete staging record is retained for subsequent publication work.

## Source and notice material

The [source collector](../../tools/delivery/sources/README.md) binds all twelve
staged inventories to fourteen OS source origins, exact Node/nginx versions and
the k6 binary's observed commit. It retains complete pinned Alpine recipe trees,
patches and SHA512 source inputs, three upstream archives, the candidate Git source
and 160 unique production npm tarballs with SHA512 SRI. Full source packages keep
their copyright/license files; image SBOMs and license inventories accompany them.
No downloaded source is executed and tested image bytes are unchanged.

Review caught missing recipe membership verification and unbounded report copies.
Canonical Git tree checks and bounded no-follow/exclusive copies replaced them.
The actual collector then verified 177 third-party source groups. Deterministic
packing separately normalizes host owners/times and retains executable recipe
modes and the verified sibling link. Registry source delivery still needs its own
public readback proof; private source collection alone does not publish a release.

## Local immutable registry plan

The [planner](../../tools/delivery/registry/README.md) uses pinned regctl 0.11.7
with private empty credential/config paths. It imports original OCI manifests by
digest, because all source archives repeat the short `transport` tag. It verifies
all twelve original config/manifest identities and six exact two-platform indexes
before writing a public-safe plan. Source archive bytes and all config bindings
are checked again. No rebuild or registry write occurs.

Actual local planning of candidate `ec080760` passed for twelve platform images
and six indexes. The owned OCI store and complete plan are retained privately.
Empty command logs are explicitly allowed; payloads remain nonempty by default
and every nonzero command exit still fails. Publication and anonymous install
remain separate acceptance steps.

## Existing-session publication

The first delivery run `43677769395` staged sources and prepared all indexes, then
GitHub refused source-release creation with HTTP 403 before registry writes.
The candidate changes workflows relative to the default branch; GitHub release
creation/update requires Workflows write, unavailable to the built-in Actions token.
The owner chose the existing local GitHub session instead of adding a CI secret.

The explicit local command revalidated the successful source run and published
`rewrite-sources-ec080760784227c4fda8f4a9d677fdc171c00bb7-43663602569`.
Its anonymous full source download matched 370,516,918 bytes and SHA256
`888ed2655a0ecd72970e4a60e978b31d3c679992de71b10f18ce243d9ae6fac0`.
No personal token was exported or installed in CI. Subsequent delivery run
`43682593954`, tool revision `39859386`, used built-in CI credentials for image
publication and retained both anonymous native jobs. It preserved all six planned
index digests and verified their remote readback. Both fresh-store anonymous pulls
and normal packaged native acceptance passed on AMD64 and ARM64, with fixture
cleanup verified. The workflow completed successfully. The explicit local finalizer
then verified the three required gates, immutable artifact ZIP hashes, exact plan
and both native proofs before publishing the [installer prerelease](https://github.com/beetlestance/beetle-lab/releases/tag/rewrite-ec080760784227c4fda8f4a9d677fdc171c00bb7-43663602569).
Anonymous full Compose/environment downloads matched their expected byte hashes.
