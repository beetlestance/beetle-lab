# Native task inventory evidence

Status: C3c read-only preparation locally verified; no persisted native plan, unlink,
receipt, ACK or refund. [Contract](../design/lld/task-inventory.md). Base196e3b8.

Private bootstrap composes genuine current same-Journal runtime/producer authority,
verified installed root and prepared task anchors. Inventory uses the shared cleanup
credit/scope and existing original-close lifetime, including Dir/fdinfo/marker closes.
It exposes a complete bounded canonical plan only after successful actual closes
and final native checks. Failed close stays owned/charged; no replacement registry.
Independent implementation review found no blocking findings and did not rerun tests.
A subsequent immutable marker projection copy and test-only corrections were checked.

## Functional checks

Host Node26.7.0/darwin arm64. Private check-runner evidence retains commands, input
identity, failures, exits and timings. Native fault seams use actual task-owned host
files with synthetic mount/path adapters; they make no Linux claim.

| Check | Actual result |
| --- | --- |
| Initial inventory | 6/7tests; expected fixture filenames corrected |
| Expanded inventory | 14tests/3files passed,11.36s |
| Composed inventory/collection/range/custody/runtime/producer/bootstrap | 186/191tests passed;5new direct SQLite assertions met the worker's exclusive database lock,39.09s |
| Corrected authority file | 8tests passed,5.47s; compare through actual worker ports |
| Final Node types/lint/architecture | Exit0;10.02s/6.79s/7.15s |
| Agent build/docs | Exit0;.73s/.39s |

The correction preserves exclusive database ownership. It compares actual released
reservation and immutable retirement via existing worker ports; it does not claim a
direct before/after aggregate quota SQL oracle. Unaffected green tests were reused.
The full PhaseA accounting/compiled cleanup chain remains separate qualification.
Initial type/lint/build-command failures are retained. Byte-directory encoding has
one narrow native adapter assertion because Node24 types omit its supported byte
option; actual returned names are checked as unknown Buffers.

Tests cover full actual prepared layout, role replacement after original close,
forged/revoked capabilities, native links/modes/root/mount refusal, invalid UTF-8,
entry/depth/canonical-plan overflow, capacity before capture, held late open after
cancellation, original failed FileHandle and Dir close, and retained scope/credits.

## Native Linux leaf

Pinned Node24.22.2/Linux arm64 in an already available task-owned agent image,
digest sha256:3efc03c60a091404c799f700a865a4ebfe659eb54b8f2213e43830bc21bb00d8.
Bundled current InventoryTree/OutputLifetime fixture ran with networknone, read-only
container root, two CPUs,512MiB,128PIDs, all capabilities dropped and bounded64MiB tmpfs.
It used only its private temporary files and two task-owned fixture bind mounts.
Exit0,.36s; no image build/publish or user-service restart.

Actual /proc/self/fd child opens, fdinfo mount reads, buffer Dir.read and all cached
closes passed. Real symlink/hardlink/invalid-byte names refused. A nested read-only
bind mount was confirmed to share st_dev with the installed root; observed mount IDs
differed and inventory returned custody refusal. Final shared retained owner count0.
The task container was never given target access or the Docker socket.

This proves the native inventory leaf. Genuine Journal/producer/runtime composition
is covered by portable functional tests; a composed native cleanup/worker/runner
chain, durable plan-before-unlink, reply-loss recovery and physical ACK are pending.
Privileged host mutation remains outside an atomic snapshot guarantee.
