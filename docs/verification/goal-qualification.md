# Current qualification goal

Completed finite goal: hosted CI corrections, demonstrated guard reliability defects, actual browser
functionality, public image/source delivery and native AMD64/ARM64 qualification.
Each item was audited against current CI/artifacts/source and actual runtime evidence.
This is not the full resource/failure release matrix or a UI redesign.

| Requirement | Accepted evidence |
| --- | --- |
| Hosted CI | Run `43684837244`, source `72243a87`: source, legacy, all six unit shards, both native Compose/scan/archive jobs and both aggregate gates passed. |
| Guard reliability | Exclusive single-link result publication fixes a real scanner custody race. [Deferred dispatch](guard-dispatch-deadline.md) fixes expired valid samples being treated as malformed input. Composed and native red/green evidence preserve custody, sample, TTL and resource limits. |
| Browser functionality | Unmodified public `72243a87` ARM64 images passed all twelve actual Chromium phases in 206.6 seconds, with cleanup and all six immutable image identities verified. |
| Sources and supply chain | Both architectures passed HIGH/CRITICAL scans, including unfixed findings; source audit, SBOMs/license inventories and 177 pinned source groups were verified. Corresponding sources are public and their anonymous full archive hash passed. |
| Anonymous native installation | Run `43688603429`, tool revision `bb805fe2`: exact-index publication/readback, fresh private-store anonymous pulls and normal native execution/cleanup passed on AMD64 and ARM64. |
| Installer delivery | The [updated prerelease](https://github.com/beetlestance/beetle-lab/releases/tag/rewrite-72243a877c84bc57076d91d6344c63b941fc569e-43684837244) is public. Existing local GitHub authentication published it after both native proofs; anonymous Compose/environment byte/hash readback passed. |

The twelve browser phases cover automatic access/authoring, execute, reports/metrics/
download, comparison, inputs/directory import, empty-folder deletion, settings,
export, durable reconnect, live reconnect/cancel and run deletion.

The old uninstrumented 9c prepare stop's exact branch cannot be reconstructed from
its retained coarse reason. It remains unattributed: neither a passing run nor a
separately reproduced defect establishes that historical cause. Current finite
qualification covers demonstrated defects and tested flows, not general stability.

The first pulled-image delivery attempt `43687479077` passed ARM64 but failed
AMD64 after 48 seconds without retaining its phase. Its cause is unknown. The
harness now retains a closed safe failure projection. Retry `43688603429` passed
both architectures without changing candidate images or qualification assertions.
Full keyboard/theme/viewport, abuse/soak/resource, crash/disk and recovery/rollback
matrix items remain in the [full rewrite ledger](../execution/remaining-rewrite.md).
