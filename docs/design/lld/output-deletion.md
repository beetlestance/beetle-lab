# Published output deletion

Status: native boundary implementation; metadata intent/refund and public run
retention follow separately. Owner: output deletion use case, same native output
namespace owner. This is not a whole-directory purge or agent-source deletion.

## Authority and values

OutputDeletionStore.prepareRemoval accepts the exact immutable published
OutputFileRecord and durable deletionId/deletionVersion. It verifies present native
custody and returns an OutputDeletionRequest plan. Metadata MUST persist that plan
before calling remove; a lost preparation reply never authorizes unlink.
The use case obtains that record only from a committed, scoped deletion intent
for a terminal, fully settled run. Browser input, preview, terminal state alone,
output metadata alone or an arbitrary path never grants native removal authority.
The metadata intent/refund contract is required before wiring this capability to
any runtime or HTTP route; the first component does not invent that transaction.

Closed request/reply <=8192 encoded bytes. Existing FileRecord remains <=4096.
Deletion ID is canonical UUID and version a positive safe integer identifying
the immutable intent generation. Progress-row versions remain separate; this
version never changes during preparation, removal or replay. Artifact phase
must be published, writer null, offset equal bytes and identity nonnull. Capture
intrinsic fixed-shape scalar snapshots before async IO; reject proxies/getters,
unknown fields, malformed bindings and unsafe numbers. The prepared plan also binds namespaceIdentity (the pinned root pair) and
preparationIdentity (the exact record, deletion ID/version and namespace). Removal
checks both before native effects. Hashes detect mismatch; authority comes from
metadata persisting the actual owned native preparation result for its captured intent. Receipt returns that same plan and phase absent. It is not a quota
refund or authority to remove another file.

Fresh preparation requires the published file to exist and match its retained
identity; missing custody fails, never manufactures a plan. This prevents an empty
but incorrectly configured root from proving absence for bytes retained elsewhere.
Both preparation and removal use the existing token/global credits.

The factory exposes OutputByteStore and separate OutputDeletionStore capabilities
from the SAME instance. It acquires the existing permanent namespace lease; no
second opener, deletion daemon, queue, file cache or independent credits. Existing
global two-job and one-original-per-token admission covers read/write/delete.
A held reader prevents deletion of its token even after caller abort. Refusal does
not inspect foreign getters or perform native work.

## Native removal and crash recovery

Derive both locations from existing organization/workspace/run/attempt/token
components. Never consume engine-relative paths. Staging must already be absent;
unknown/staging files are preserved. Published present requires exact existing
published identity, stat/inode/size and single-link evidence before unlink. A
replacement inode, extra link, symlink, changed bytes/stat, wrong binding, root or
ancestor identity fails. Use existing published identity validation, not a second
hash parser or a whole-file buffered read.

Reuse one shared verified single-file unlink primitive for input/output adapters:
verify named/opened identity, check ancestors, unlink, check again, fsync parent.
No directory removal or recursive enumeration. If published is already absent,
recover only with the previously persisted exact plan and matching namespace.
Never obtain a fresh plan from an empty directory or rewrite its fingerprint. Fsync nearest existing parents
and require both names absent; never synthesize missing child directories.

A positive result waits for ALL original handle closes and then rechecks lease,
root/ancestor identities and absence. Absence confirmation checks ancestors again
after named absence so a replaced directory cannot manufacture a receipt. This
records observed owned-namespace absence, not host-wide free space or an assertion
about unrelated external handles. Receipt is replayable from the same immutable
intent/record after interruption; no new token/identity is allocated.

Cancellation/deadline after unlink or lost acknowledgement can leave absent bytes
with no positive receipt. Preserve metadata charge and retry the SAME intent.
Fsync/identity/post-close failures cannot become absence success. Failed original
close is sticky: retain job/token, pending settlement, namespace lease and process
owner; do not allow another opener or quota refund. Close fences intake immediately,
awaits original work and releases the lease last only after successful cleanup.

## Metadata and integration requirements

Before runtime use, add one scoped durable deletion-intent owner with immutable
captured published slots, durable native preparation plans, version/replay identity, reader/writer exclusion and
bounded discovery. Deny active/unknown/pinned runs and new artifact reads once
intent is committed. Reconcile issued originals; do not infer physical absence
from a timeout, ENOENT at an unchecked parent, event ACK or stale metadata.
Persist every native preparation before dispatching its unlink. Reject preparation
namespace changes across a deletion intent and never replace a lost plan with a
new token. Only exact successful native receipts can advance per-file absence. Final refund
and tombstone must wait for every required file, retained event/payload ownership
and original writer closure under an idempotent metadata transaction. Storage
and receipts remain charged during partial/failed deletion. Recovery reuses the
same intent and never rebuilds a missing source or reruns a test.

## Acceptance

Use task-owned real roots/files and existing fault seam. Cover publish/remove,
absence replay/reopen, wrong empty namespace, changed plan/intent and missing
fresh preparation, preserved directories and missing ancestors; wrong binding,
identity/inode/size/link/symlink/staging presence; closed malformed/proxy/getter
values before IO; held read/unlink/close and two shared credits; abort/deadline,
parent fsync/ack loss, post-close name/directory reinsertion and sticky close failure.
Reuse existing input-removal tests after primitive extraction. Run scoped output
lifecycle checks, Node types, lint, architecture and docs. No user data, global
prune, Docker or release qualification is implied by native component success.
