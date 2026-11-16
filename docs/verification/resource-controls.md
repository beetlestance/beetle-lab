# Direct native kernel controls

Q01 native AMD64/ARM64 kernel evidence; installed-agent qualification is separate.
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

## Native hosted execution

[CI43743270130](https://github.com/beetlestance/beetle-lab/actions/runs/43743270130)
passed both native jobs at clean harness `68d9f989`, using the same public722
engine index/platform/config bindings. No image rebuild/publication occurred.
Both runners exposed four CPUs, Docker28.0.4 and kernel7.0.0-1017-azure.
The recorded RAM ceilings were16,760,344,576bytes on AMD64 and16,715,923,456bytes
on ARM64; the same VM-available safety precondition passed before every fault.

| Probe | AMD64 | ARM64 |
| --- | --- | --- |
| CPU demand |8083ms,8,094,257us,81 throttled periods;100.14% onecore |8074ms,8,088,807us,81 periods;100.18% onecore |
| Memory |OOMKilled true/137,512MiB/swap0 |Same authoritative OOM/control result |
| PID refusal |121 children/current128,EAGAIN,maxevent1 |Same limit/refusal result |
| Descendant shutdown |Three processes/nine tasks,2065ms forced stop/137 |Three processes/nine tasks,2056ms forced stop/137 |

Both closed outcomes report passed/cleanupVerified; all four probe containers
were removed on each runner. Only closed outcomes were uploaded. Release metadata,
asset size/SHA and actual Git tag source were verified before the anonymous engine
pull. Expected matrix architecture was checked before pull/container effects.

## Still outstanding

Installed-agent exit causes, sampling accuracy and both-platform reservations and
shared-pool scheduling, cancel/timeout progress, output flooding, overhead/soak,
disk and recovery remain separate requirements. No V06/V07/V17 group is closed
solely by this packet. The immutable image, ownership descriptor, source hashes,
raw private logs, commands and closed outcome are retained in task evidence.

[Active restart/cancellation](active-recovery.md) adds scoped packaged ARM64
producer and reservation evidence; its limits remain explicit.
