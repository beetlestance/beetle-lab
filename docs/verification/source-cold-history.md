# Source-candidate cold history compatibility

Native ARM64 source imagesb48936d8 from qualified CI43793313636, with archive,
config/manifest, scan and isolated restoration proofs verified before execution.
The default-UID Compose fixture passed92.542s, then independent cleanup passed.
The six images were reused locally; this is source-image execution, not fresh pulls.

One synthetic run made one readiness/work request. All eight source artifacts were
verified before cold stop. Packaged backup, fresh history-only restore and exact
resume kept the existing128MiB/2000-entry/45s recovery bounds. Maintenance remained
UID1000:1000,0.5CPU/256MiB/PID64, read-only root/no network/capabilities; only backup
received the configured socket and group. No permissions were repaired.

| Case | Accepted observation |
| --- | --- |
| Foreign resume | Actual packaged CLI exited1, OOM=false, exact conflict code for another operation ID. Arbitrary errors cannot satisfy the oracle. |
| Current reader | All8 artifact IDs/sizes/hashes,26471bytes; mutation403 and read-only cookie continuity through restart. |
| Older published reader | Verified72243a87 installer/frontend immutable pair read the same history and all8 hashes/26471bytes, refused mutation and retained its read-only session through restart. |
| Exact resume | Current installer returned the same completed restore identity; restored metadata and both source database main hashes stayed unchanged. |
| Cleanup | Current helper/viewer resources removed before the older reader; normal and independent exact-owner cleanup passed. |

The published run.ts entrypoint and new source.ts share the same execution owner;
its previous six-role verification, backup/history/resume order and final phase
remain. Partial phase facts survive later failures. Two refusal-parser tests prove
that OOM/arbitrary/ambiguous/oversized diagnostics cannot become expected conflict;
types, lint, architecture/docs and independent review passed before native effects.

This qualifies the recorded read-only historical-reader pair and matching data
format. It does not permit old images against serving data, mutable/in-place
rollback, future incompatible schema rollback, or imply native AMD64 source-path
proof. The earlier published-image ARM/AMD cold evidence remains separate.
