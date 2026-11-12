# Native portable-script custody

Status: shared native component for independent export; job orchestration pending.
Owner: engines/k6/wrapper/artifact-custody. The engine owns this work inside its
admitted container, never a backend-local build or arbitrary browser file selector.

Reuse the existing standalone compiler/builder. Its owned BuildOutput carries a
fresh fixed jobRoot/standalone/suite.js, final bytes and peak scratch bytes. Capture
those scalars before async work. Require nonnegative current UID, canonical absolute
job root/path, bytes<=peak<=caller allowance<=64MiB. Refuse invalid profiles before
IO. Never overwrite, delete, walk or infer a descriptor solely from supplied hashes.

Open only the fixed existing file. Shared native custody validates owned0700
canonical parents, owned0600 regular file, one link, exact length and stable
inode/stat before/after. Compute/verify two hashes, fsync, confirm every original
file/parent close, then reconcile named file/root. Script descriptor uses the
actual digest/bytes and fixed standalone/suite.js prefix inside the job namespace.
The outer job-root identity must also remain the same after native work.

Existing summaries, numeric/target/report artifacts retain their exact descriptor
kinds/paths and verification. Metric archive uses the same bounded file-hash reader.
One64KiB scratch buffer, positional reads, <=ceil(bytes/64KiB)+32 calls plus one
EOF probe per pass. Refuse short/stalled/invalid counts or non-EOF. Caller-specific
byte limit<=256MiB preserves existing archive allowance; script limit remains64MiB.
Check the owning synchronous fence before/after every issued read. Hashing alone
proves no file ownership, publication, admission or global memory bound.

One script job owns the original native work. Result resolves only after its
actual closes and final root check. Settled waits for original work and rejects
when cleanup is unknown/failed; a timeout/cancel never fabricates file absence or
refund. No speculative retry. Parent owns cancellation/deadline and must recheck
its fence in the publication continuation, including a stop after result settles.
Required close/sync/root cleanup drains independently of a stopped publication
fence. Successful native cleanup does not mask the original cancellation; skipped
publication checks alone never invent cleanup failure. Final named root identity
is sampled after canonical-path IO before success. Failed cleanup remains explicit until the process/container's physical stop proof.

No standalone job dispatcher, supported capability, queue, result manifest, public
API or download workflow is supplied by this component. Those remain in the
[independent export job](standalone-export-jobs.md) contract.

Acceptance uses actual files and actual compiler/builder, plus synthetic bounded
read/close holds. Cover >2MiB content with constant scratch, expected descriptor,
size/path/mode/link/symlink/corruption refusal, stopped/read/close originals, sticky
cleanup failure and preserved existing artifact/archive behavior. No real-user
files, container or target workload are part of component qualification.
