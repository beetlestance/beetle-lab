# Packaged cold recovery

## Accepted scope

A task-owned default Compose installation from the six immutable public72243a87
images passed one native Linux ARM64 cold recovery trial in67.717seconds. The
harness base was23bb8c82 with frozen dirty qualification-file hashes; recovery,
installer, backend, contracts, dependency lock and Compose inputs are unchanged
from72243a87. The later agent stats change does not qualify recovery by itself.
This trial reused available verified images; it did not repeat anonymous pulls.

The single synthetic run performed one readiness and one work request, with no
unexpected requests. It published all eight expected artifact kinds. Source
content sizes and SHA256 values were checked before stopping every owned peer.
Installed control reserve matched actual ceilings:1350CPU milliseconds,
603,979,776memory bytes and160PIDs. No user installation was selected.

Packaged maintenance ran as UID/GID1000:1000 with0.5CPU,256MiB RAM, no swap,
64PIDs, read-only root, no network/capabilities and no new privileges. Backup
alone received the configured local Docker socket and its supplementary group.
Restore and completed resume had no socket mount or supplementary socket group.
Requests and destinations were private siblings in the fresh setup-owned home;
no existing source permissions were repaired.

Backup captured13files/seven directories:1,500,868payload bytes,4,576manifest
bytes and the separate65,536byte control allowance. The fresh historical-only
restore served all eight source-bound artifact IDs/kinds/sizes/hashes through the
packaged viewer and frontend:26,531downloaded bytes. A public mutation received403.
The same read-only browser session survived viewer restart. Exact completed
resume returned the original history/operation identity. Both source database
main-file hashes stayed unchanged across backup, viewing and resume; restored
metadata also stayed unchanged. Owned containers/networks/live volumes were
removed and cleanup passed. Synthetic source/archive/history directories remain
as private evidence; they are not a running installation.

## Evidence and limits

Private packet evidence: `.agent-work/packaged-cold-arm/`, including frozen input
hashes, scoped check results, native outcome and original owner/log paths. The
entrypoint is `tools/qualification/native-application/cold/run.ts`, with an existing
publication record, new absolute output directory and optional local context.
Its composed budget is300seconds; each CLI original is bounded to60seconds and
request results to45seconds. Only the CLI containers are retained until owned
cleanup; helpers are removed on exit. Independent pre-run review corrected socket
exposure, source-bound artifact comparison and source hash coverage. Node types,
changed lint, architecture and docs checks passed before the trial.

The native Node24.22.3 SQLite backup prerequisite was independently source-read:
verified upstream archive SHA256
`48ca3aa8a9b02133356922ef4fc80200e00598c80a4ef446f7c39a459222593d`;
`src/node_sqlite.cc` member SHA256
`1c3f4b5eec2ebaeb8d22ebf548b98a9303f5288452efa55f7f7e7957fbe792fb`.
ScheduleBackup opens the destination and initialises sqlite3_backup before
ScheduleWork; the binding invokes ScheduleBackup directly. This is a source-order
prerequisite, not a substitute for packaged runtime execution.

Native AMD64, fresh source-install recovery, interrupted operations, controlled
ENOSPC, foreign resume rejection, serving-purpose refusal and supported rollback
still need their separate composed proofs. Unit/seam evidence remains scoped to
those tests. No mutable restore adoption, full disk, soak or complete release
acceptance follows from this trial.
