# Cleanup control value contract

Status: C1 values locally verified; values grant no IO or refund authority.
Owner: agent cleanup-control, used by the [namespace reserve](staging-namespace.md).
Physical lifecycle remains in [retirement](output-retirement.md).

## Native plan

Closed protocol1/performance purpose binds exact original scope, generation1 and
intent digest, installed/task namespace identities, retirement request digest and
retirementVersion1. The request digest binds the complete future retirement request.
No caller path becomes native permission. Export cleanup needs a separate purpose
contract; reserving its capacity does not enable these performance operations.

At most512 entries include the root. At most32 relative path levels,4096 UTF-8 bytes
per path and128KiB complete canonical JSON. Root is the empty path, first and a
directory. Paths are unique, strictly lexically ordered by JS code units; each
parent must already be a directory. No absolute/empty component, dot/dotdot,
backslash, controls or unpaired surrogate. Both decoded shape and complete output
remain bounded. Entries share root device/UID/GID and have unique native identities.
Directory ownership uses device/inode/UID/GID/mode; files add exact
bytes and single-link1. Integers are bounded canonical decimal strings; rounded
numbers, negative/exponent/leading-zero aliases and special-file modes reject.

Directory size, mtime and ctime are mutable under child operations and are not
identity. Physical preparation must additionally verify full owned inventory,
namespace/task anchors, no links/nested mounts, original drain and cached closes.
A well-formed plan is not evidence that any native observation happened.

Canonical SHA256 identifies the exact stored plan. Persist it before unlink;
resume that same plan, not a reconstructed empty-root plan or generic ENOENT.
Current proposed native windows remain64KiB and30s per issued operation. Over-bound
work stays pending/charged. Qualify the supported actual generated layout against
these same bounds; never silently enlarge them after admission.

## Progress and receipt

One mutable progress value binds plan identity, entry count, removed count,
version and prepared|cleaning|files_absent state, <=8192 bytes. Prepared has count0,
version1; cleaning starts at count0/version2. Each next version removes exactly
one entry in reverse plan order, including actual parent sync and original close.
Cleaning count is below entry count. files_absent has the full count and
version=count+2; maximum514 for512 entries. Exact replay is idempotent; skips,
rollback, foreign plan/count and premature closure reject.

Native removal may precede a lost progress commit. Recovery must use its persisted
plan and actual native owner/absence receipts; counters alone are not proof.
The separately bounded receipt (<=4096 bytes) binds performance purpose/version,
retirement request, both namespace identities, exact plan and final progress
version, with closure owned-task-absent-after-original-close-v1. Its canonical digest
identifies the value, not cryptographic proof of filesystem IO. Only the future
trusted native/Journal chain may establish and persist that closure.

C1 codecs can validate fixture values; no cleanup execution/ACK endpoint exists.
C3/C4 must compose actual complete absence, all original closes and durable replay
before these values can advance backend progress. C5 owns the compact replay slot's
retention/expiry policy and separate final settlement; it cannot discard Offer
identity or refund based only on these syntax checks. Logical reservation does not
preallocate disk/WAL blocks or guarantee cleanup on a full filesystem.
