# Decision 013: bounded live mailbox custody

Status: accepted for implementation; runtime integration and qualification pending.

The live snapshot writer cannot safely replace/delete child names in the engine's
shared writable output root. Directory descriptors pin a directory but do not make
child identity checks and rename/unlink conditional. Review identified a foreign
file race; the unintegrated adapter draft was retained privately and retired.

Use one fixed mailbox in a dedicated, initially empty per-attempt local-driver
tmpfs volume at `/beetle/live`, capped at 128KiB and four inodes. Container-local
HostConfig.Tmpfs is not archive-readable; real proof and Docker's documented copy
limitation rejected that combination. The local-driver volume was proved readable
through the bounded archive endpoint. Carve its allocation from existing
temporary-memory/admitted resources; never increase an Offer or hard ceiling.
Keep it separate from staged inputs, secrets, retained outputs and host user data.
The producer only writes through its original file descriptor, without renaming
or unlinking. The runtime owner must verify exact driver/options and immutable
installation/attempt/generation labels before use or removal; never reuse a foreign
named volume. Container/volume teardown after physical stop owns mount cleanup.

The mailbox has a fixed 128-byte header, 65,536-byte payload area and 128-byte
footer. Sequential busy/body/commit writes plus matching committed envelopes and
SHA256 detect partial/concurrent reads. Revisions never wrap or restart per epoch.
Size changes, malformed envelopes or hash mismatches mean unavailable; no retries,
old-frame freshness renewal or fallback success. The existing frame codec still
validates scope, epoch, selected series, counters and percentile semantics.

Tmpfs bounds allocated data/inodes even if another engine writer grows or truncates
the file. Sparse oversized logical extents are rejected without materialisation.
Agent reads use one hard byte/deadline bound through the Docker archive endpoint,
parse one fixed regular entry without extracting paths, and retain the actual
request original under existing telemetry credits. No exec/helper process,
sidecar, new push authentication, subscriber registry or retained metric corpus.

This replaces the proposed atomic JSON snapshot files, not final sealed history.
The sink port remains unchanged. Explicit admission, mounted-path isolation,
archive/read drainage and native proof are required before runtime enablement.
