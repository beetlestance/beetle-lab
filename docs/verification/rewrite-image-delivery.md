# Qualified image transport

Scope: preserve exact tested/scanned candidates for later registry delivery.
Publication, anonymous pull and a pull-based installation are not established here.

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
source daemon is never pruned or selected by this verifier. Actual hosted success
of this new restoration gate is still pending.

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
its isolated-store restoration still needs hosted proof. No registry write occurred.

Hosted restoration and [remaining release blockers](qualification-blockers.md)
still require their own results. Existing legacy publication and default tags remain
unchanged; this packet does not publish images or a release.
