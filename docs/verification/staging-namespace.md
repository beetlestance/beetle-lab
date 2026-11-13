# Durable staging namespace and cleanup capacity

Status: scoped local verification and native arm64 composition passed.
Five baseline failures were recorded at C1 acceptance; the [repair](lifecycle-baseline-repair.md)
subsequently resolves them. No full-suite/release claim.
Owner contracts: [namespace](../design/lld/staging-namespace.md),
[control values](../design/lld/cleanup-control.md),
[retirement](../design/lld/output-retirement.md).

## Implemented boundary

Journal migration016 persists an immutable installed namespace intent/nonce marker
and exact root/native anchor. Runtime startup validates actual roots and marker,
closes original native owners and commits the anchor before configuring admission
or starting producers/intake. Device/inode values remain exact bigint/decimal.
Fresh history and an actually empty root are required for initial binding. Existing
history without anchors stays recovery-required; migration does not invent custody.
Ordinary container recreation may change ancestors above the mounted root, while
mounted-root or daemon identity changes require recovery.

Preparation persists exact original/purpose/spec/runtime-name intent before mkdir,
then commits actual task/input/output/secrets identities before provider writes.
Partial directories and completed task anchors are not adopted for another prepare.
The sole pre-existing runtime-name derivation is shared with Docker preparation.

Admission atomically reserves196608 logical bytes/version1 for performance and
export originals. Full reserved capacity counts against quota; ordinary payload
cannot borrow it. It is not physical disk/WAL preallocation. No refund or reserve
release exists in this change. Old rows retain version0/zero/null explicitly.

Pure bounded native plan/progress/receipt codecs freeze future control limits.
They do not execute deletion, prove absence or grant cleanup acknowledgement.

## Verification record

Task branch feature/durable-staging-namespace, base44a95b8. Full source/check plans,
actual commands, timing and failure logs remain in task-owned private evidence.
Implementation source:0b93867509b8fc031aefd734e61924d07025836b. Frozen node
TypeScript, lint, architecture, docs and agent/backend builds passed. Final native,
namespace, close, startup and migration checks passed91 tests in17 files (56.86s).
The maximum-layout plan measured40106 bytes against131072.

The broad agent lane ran217 files/2129 tests in516.34s:201 files passed;61 tests
failed across16 files. Exact marker-only assertions, historical zero-control
projections, reserved-versus-ordinary quota and the current4095-held-original
fixture were corrected. A141-test/12-file correction pass had140 pass and one
over-broad test edit; the final six-test migration check restores the correct
explicit migration014 version assertion. No production gate was weakened.

Five failures in four unchanged lifecycle/backend files independently reproduce on
clean44a95b8 (25-test baseline probe14.19s). They were queued and subsequently resolved by the linked repair:
callback-retirement twice, cancellation-before-admission fencing, monotonic clock
failure, and concurrent absence/discovery. This is scoped C1 evidence, not a green
whole agent suite. The output-limit integration timed out in the broad lane and
passed unchanged both on baseline and in the correction lane; keep that transient
failure in the record. Do not infer long-run timing qualification.

Packaged arm64 composition passed in12.93s with agent0b93867509b8 and the exact
unchanged H3 engine image. Agent image build15.68s; bounded builder was removed.
One readiness request and one work request, no unexpected target requests, six
verified artifacts, numeric4 history summary and backend metadata reopen passed.
Backend retained charge104331 remained exact. Runtime inspection enforced1 CPU,
512MiB RAM and128 PIDs. Task containers/network were cleaned; user services stayed.

Post-stop Journal inspection found one bound installed namespace and one prepared
task with all four roles, exact scope/purpose/namespace binding and196608/version1
control capacity retained. The host marker digest matched the committed marker.
Mounted-VM inode facts are the original agent observations, not fresh host-native
reobservation. No agent-restart/cleanup-removal proof is implied. The fixture's
engine-log diagnostic was unavailable; retain that limitation in private evidence.

Focused checks cover compiled Journal replay, independent worker validation,
quota exhaustion, legacy preservation, task scope/purpose/name uniqueness, native
marker/root/link failures, delayed/rejected close custody and partial preparation.
Actual maximum-layout fixture includes128 inputs,64 maximum-length secret names,
maximum-size config and output paths:208 native entries, bounded by the512-entry
and128KiB canonical plan limits. This is layout proof, not cleanup execution.

Independent review found a named-marker race during descriptor close. The fix
checks stable read stats, exact named identity after close and around commit/token
publication. Five actual filesystem regressions cover unlink, replacement,
in-place edit, read-time edit and mutation during the committed reply. Two client
regressions reject well-formed replies that change captured marker/directories.
Review of that correction found no remaining C1 blocker. Final review also accepted
nonblocking marker opens (actual FIFO rejection) and the current held-slot fixture.

The first integration attempt hit sandbox EPERM on loopback sockets and was stopped
with its logs preserved. The authorized local-network lane retains the same test
assertions. Exact root-content assertions include only the installed marker;
pre-provider failure still cannot create a task. Historical schema projections
retain explicit unreserved state rather than manufacturing new authority.

## Limits

C2 producer/read retirement, C3 persisted native inventory/removal, C4 authenticated
cleanup ACK, C5 replay-safe settlement and C6 public retention/delete remain open.
No generic404, timeout, codec value or metadata flag establishes cleanup or refund.
No user service restart, push, publication or deployment is part of this evidence.
No browser, Compose, amd64, soak, hosted CI or release qualification is claimed.
