# Native published-output deletion evidence

Status: locally verified native component; metadata/runtime retention pending.
Source: the feature commit containing this report, based on7f41423.
Owner: same native output instance, namespace lease and global/token admission.
No SQL migration, public API, automatic janitor, quota refund or user data change.

## Exercised boundary

prepareRemoval requires present verified published custody and post-close file/root
checks. Its bounded plan binds the exact record, immutable deletion intent/version
and namespace. The future metadata owner must persist that actual returned plan
before unlink. Hashes detect mismatch; authority comes from that owned preparation
and committed metadata intent, not a caller recomputing fingerprints.

remove verifies the plan before native effects. Staging/unknown files stay intact;
present published bytes require exact identity/inode/stat and one link. Input and
output adapters reuse one checked single-file unlink/parent-flush primitive, with
an explicit location/file match. No recursive removal or directory creation/deletion.
Absence replay requires the original plan and namespace. A fresh preparation
cannot turn missing custody into a plan.

Positive absence waits for all original closes, namespace lease and root/ancestor
checks, named absence and another ancestor check. A held reader owns the same token;
two readers consume both global credits. Abort/deadline does not refund native
ownership. Failed close leaves settlement pending and preserves token/lease/process
ownership until confirmed death; a later owner replays the same prepared intent.

## Local checks and corrections

The initial implementation falsely accepted an explicit published record in a
wrong empty namespace while the original file remained elsewhere. A focused native
regression reproduced that false success in1,495ms before the preparation contract
was added. The revised16-case native lane passed in5,498ms: correct removal/reopen,
missing ancestors, wrong namespace, altered plan/intent, missing fresh preparation,
corrupt record/inode/bytes, extra links, symlinks/staging, malformed getters/proxies,
unlink acknowledgement loss and failed directory flush.

The prepared-plan lifecycle/process lane passed11 cases in13,406ms. It covers
held reads/unlink/close, cancellation and deadlines, post-close name/ancestor
reinsertion, real cross-process namespace exclusion and sticky file/directory
close failure until synthetic child death. Existing input-removal cases passed
with the shared primitive extraction. Node types passed8,807ms, changed lint
1,037ms and architecture8,872ms. Authored docs/link checks precede integration.
All commands used the scoped check runner; original failure logs remain private.

A child mode initially lacked a narrowed string type; its empty default preserves
invalid-mode refusal. The next-boundary typecheck also caught a previous CLI close
callback's inferred handle type; that unrelated one-line correction was integrated
separately as7f41423, with its own Node/file/lint evidence. No gate was weakened.

## Limits

Tests use real task-owned files/leases, synthetic records and bounded child
processes. There is no real-user deletion, Docker/engine/browser run, release
qualification or whole-host free-space measurement. The receipt witnesses owned
namespace absence; unrelated external handles and whole filesystem usage remain
outside that claim. Private requests/replies are <=8KiB and records <=4KiB.

Metadata must add scoped intent/version/pins, persist actual preparation plans,
exclude new reads, discover bounded pending work, accept exact receipts and only
then settle retained payload/event ownership and storage charges. Never infer
refund from terminal Run state, timeout, unchecked ENOENT or event ACK. Agent-source
retirement is separate. This native capability is deliberately unwired until that
owner exists; it does not complete F14 retention or free cancelled unknown outputs.
