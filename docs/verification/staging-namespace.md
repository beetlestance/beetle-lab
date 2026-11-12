# Durable staging namespace and cleanup capacity

Status: implementation under verification; local integration not yet accepted.
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
Frozen integrated verification and packaged native qualification are pending.

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
Review of that correction found no remaining C1 blocker; final gates remain pending.

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
