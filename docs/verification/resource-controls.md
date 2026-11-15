# Direct native kernel controls

Q01 tool/ARM64 evidence, not full resource or installed-agent qualification.
[The packet plan](../execution/resource-parity.md) and
[harness](../../tools/qualification/resources/README.md) freeze the bounds.

## Actual execution

An unmodified public engine from source `72243a87` ran four sequential synthetic
programs on Linux ARM64, Docker29.9.3/kernel7.0.14-linuxkit, Node24.22.3. The Docker
VM declared10 CPUs and12,526,305,280 bytes RAM; each worker observed more than
1.5GiB VM-scoped available headroom before its fault. This is qualification-host
evidence, not a minimum installation tier or physical-machine temperature claim.

| Probe | Observed result |
| --- | --- |
| CPU | Eight-second/four-worker demand:8022ms wall,8,086,544us aggregate CPU,80 throttled periods.100.80% of one core fits the declared one100ms period plus50ms accounting allowance. |
| Memory | Hard512MiB/swap0; authoritative Docker OOMKilled true and exit137. A generic137 exit alone would fail. |
| PIDs |121 small children, cgroupcurrent128, EAGAIN and one kernel limit event; every child reaped. |
| Descendants | Three processes/nine tasks before stop; ignored TERM required forced stop in2054ms, exit137/OOM false, PID namespace stopped. |

All cases checked effective cgroup settings, UID1000, empty capabilities and
no-new-privileges; readonly/no-network/no-init settings matched the declared
container profile. All four owned containers were removed. The existing check
runner exited0 after17.331 seconds. No registry write, image build, target request,
user-service restart, host filesystem fill or daemon prune occurred.

Harness base `42ed1d58` was dirty: exact relative file hashes and runtime metadata
were retained rather than claiming clean-commit execution. Combined harness file
snapshot SHA256: `b2dcf2de5518c2f46909bdd585c3bb8e75a772d1576a995daada3b24184a903a`.
The shared Docker helper was extracted byte-for-byte and its old test facade
re-exported the same class; architecture boundaries were not relaxed.

Nine focused tests, Node types, changed lint, architecture and docs passed.
Independent review caught and corrected Node x64/amd64 naming before execution;
post-run review accepted only the recorded ARM64 direct-kernel scope.

## Still outstanding

Native AMD64, installed-agent exit causes/resource observations, reservations and
shared-pool scheduling, cancel/timeout progress, output flooding, overhead/soak,
disk and recovery remain separate requirements. No V06/V07/V17 group is closed
solely by this packet. The immutable image, ownership descriptor, source hashes,
raw private logs, commands and closed outcome are retained in task evidence.
