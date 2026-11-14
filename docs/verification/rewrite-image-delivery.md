# Qualified image transport

Scope: preserve exact tested/scanned candidates for later registry delivery.
Publication, anonymous pull and a pull-based installation are not established here.

## Authority and bounds

Optional CI input `prepare_rewrite_delivery` defaults false and grants no registry
permissions. After successful native qualification and scans, the job requires one
closed passed/clean outcome, matching revision/architecture and exactly six scan
identities. Every Docker image ID must match both execution and scan evidence.
Saving IDs avoids a mutable-tag substitution or an untested rebuild.

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

## Actual local proof

The corrected producer archived the six unchanged, scanned de4f908 ARM64 images
from the accepted normal Compose result: 107,069,440 raw tar bytes and 106,588,791
compressed bytes. The compressed SHA256 and role bindings are retained privately.
All six OCI index descriptor IDs and their manifest/config hash chains matched the
tested identities, Linux/arm64 and source revision. No image rebuild or load was used.
This Docker containerd store reports OCI manifest IDs; those are distinct from
config digests. A first proof probe incorrectly equated them and was not accepted.
Registry delivery must respect that distinction and verify content after transfer.

Thirteen identity/file cases passed, plus five producer cases covering active flood
limits, ignored TERM/deadline escalation, actual process exit, exclusive output,
partial failure and bounded private stderr. Types, lint, architecture, docs and
actionlint passed. Review caught post-write-only limits; counted producers replaced
them before integration. The earlier unbounded-output proof is not accepted evidence.

Hosted archive transport and [remaining release blockers](qualification-blockers.md)
still require their own results. Existing legacy publication and default tags remain
unchanged; this packet does not publish images or a release.
