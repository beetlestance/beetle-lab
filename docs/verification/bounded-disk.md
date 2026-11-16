# Bounded full-storage input recovery

Date2026-11-16. Native ARM64, unmodified packaged installer/backend23bb8c82.
The final trial passed15.807s; normal and independent ownership-checked cleanup
passed. This is backend/input qualification, not a whole-stack capacity test.

A fresh local-driver tmpfs volume was capped at64MiB, UID/GID1000 and0700.
A bounded keeper held the mount continuously across helpers/backend restart;
otherwise the tmpfs contents would disappear on last unmount. Provisioning used
the public packaged CLI, with only the explicit advanced free-space reserve set
from256MiB to0. Attempt/service caps, logical pools and factory defaults stayed.
The first helper required at least1.5GiB available Docker-VM memory.

| Boundary | Actual proof |
| --- | --- |
| Full filesystem | Bounded64KiB filler writes reached actualENOSPC; statfs reported0 available bytes, exact tmpfs type/64MiB size. First fill64913408bytes; second64864256bytes. |
| Upload refusal | A16KiB staged prefix existed before filling. Next append returned503/capacity_unavailable; offset/prefix hash remained unchanged. |
| Upload recovery | Removing only the owned filler allowed the remaining bytes, seal and exact32KiB download/SHA256 verification. |
| Delete uncertainty | Under the second full volume, delete and status read returned503. The fixture kept state unknown; it did not infer deletion/refund. |
| Explicit recovery | Free filler, restart the exact same backend container, wait with bounded GETs, replay the identical delete request ID/version, require authoritative deleted state. |
| Physical absence | Both staged and published input file paths were absent; HTTP content returned the documented409 for a deleted record. |

The backend-only fixture intentionally has no capacity-producing agent. Namespace,
session and input routes work independently; runtime settings readiness is not a
prerequisite. Session identity persisted through restart. No engine/test work ran.

Earlier attempts remain recorded: unrelated absent-agent settings readiness;
Buffer subclasses refused by the SDK's intrinsic Uint8Array contract; assuming
metadata remained readable while full; expecting404 instead of the existing409
deleted-content contract. All four failed trials passed independent cleanup.
Their corrected assertions preserve uncertainty and add native absence checks.

Owner/source/volume plan precede effects. Cleanup validates exact project/revision
labels and tmpfs driver/device/options before removing only owned containers,
network and volume. Original byte jobs drain before teardown. No host data bind,
host-disk filling, prune, user service or user input was used.

This proves the recorded bounded tmpfs/input and explicit-restart recovery path.
It does not establish uninterrupted service while full, every output-publication
or deletion crash point, power-loss durability, general host pressure or AMD64
execution. Other storage/recovery requirements remain in the
[resource/parity packets](../execution/resource-parity.md).
