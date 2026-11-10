# Native output file ownership

Status: locally implemented and independently reviewed. Shared physical custody/
promotion, namespace lease and byte adapter are integrated. Combined transfer and
metadata-worker-failure process proofs remain pending. Depends on
[output adoption](output-adoption.md) for original allocation and durable tokens.
No filesystem receipt alone authorizes terminal state, deletion or quota refund.

## Parent lifetime

The backend parent owns one output-file adapter independently of the metadata
worker. Before any recovery or file mutation it acquires one small SQLite sidecar
in DELETE/exclusive mode, using a retained connection and a short busy timeout.
This is cooperative exclusion for a trusted private local Docker volume. Network
filesystems and arbitrary same-UID mutation of that private namespace are outside
this guarantee. Do not infer writer death from elapsed time or a PID lookup.

Reserve the same-process namespace owner before opening the sidecar or invoking
callbacks. A second adapter refuses before any raw descriptor open/close. No
metadata worker or diagnostic probe may open that inode: closing another descriptor
in the same process can discard POSIX locks, as documented by
[SQLite](https://www.sqlite.org/howtocorrupt.html#posix_advisory_locks_are_canceled_by_close).
Check named identity with lstat rather than opening an inspection descriptor.

The sidecar has one permanent name outside staging/publication moves. Fresh
initialization alone creates it with O_EXCL, private mode, file and parent flush.
Ordinary recovery never recreates it. Pin canonical ancestry, bigint device/inode,
UID/GID/mode and single-link identity; replacement, absence or wrong settings fences
work. Verify DELETE/exclusive mode and actual lock acquisition, with bounded page,
cache and busy settings. Do not use the metadata database as this lifetime lease.

## Originals and recovery

The file adapter reserves at most two jobs and one writer per artifact token before
async capture/IO. Retain each issued open/read/write/sync/directory/close operation
through its actual settlement, including cancellation. Cached close synchronously
fences admission and requests stop, waits for all originals and successful cached
descriptor closes, then releases the sidecar connection last. A failed descriptor
or SQLite close is sticky: retain the lease/registry fence and refuse positive
receipts or replacement owners. Rejection alone does not prove custody release.

Metadata-worker failure fences new mutations but retains the parent adapter,
sidecar and issued native originals. Same-parent recovery reuses that owner only
after old originals drain. A replacement parent must first acquire the permanent
sidecar, then reconcile the existing durable token, file offset and expected full
SHA256. Process exit releases the cooperative lock; it does not prove the prior
write, publication or cleanup succeeded. Never allocate a replacement file merely
because the native/metadata reply was lost.

## Physical custody

Use one app-local files/custody owner shared with inputs: native flags/operations,
bigint root and directory pins, tracked original handles, checked file reads and
writes, flushes and whole-file SHA256. Input row/state/error mapping remains in
inputs; output token/state/error mapping remains in outputs. No agent runtime
imports, duplicate physical verifier or generalized storage framework.

Derive paths only from validated namespace/run/attempt/upload UUIDs. Host paths and
raw filesystem errors remain private. Expected length/hash comes from the one
adopted manifest; metadata version or SQL writer claims do not replace native
exclusion. Verify bounded offset arithmetic and streaming buffers, including empty
files. Later reads must prove the published file still matches its receipt;
a staging identity that excludes append-mutated fields is insufficient by itself.

## Publication protocol

Use same-filesystem no-overwrite hardlink, proven exact two-alias custody, then
staging unlink. The two deterministic names share one inode/content charged once
in A, rather than a second payload copy in D. Reconcile stage-only, verified
stage+published aliases, or verified published-only state under the same token.
EEXIST alone is insufficient. Refuse an unrelated destination, extra links or
contradictory identity. Require full expected length/hash, private ownership/modes,
file flush, both parent flushes and successful original closes before receipt.

Extract the existing input physical promotion sequence for reuse, keeping input
state eligibility and zero-byte reconstruction policy outside that common owner.
Output reconstruction authority comes from its adopted manifest/token; absence
alone does not authorize creating or declaring an empty artifact.

## Byte-store contract

app/src/ports/output-bytes.ts owns the private byte-store interface. Composition
opens existing canonical sibling staging/published roots and the permanent lease
in their common private parent. Explicit fresh provisioning alone creates the
sidecar. Validate all record/context values and capture at most4096 record bytes;
reserve two jobs/one original per token before capture, callbacks or IO. Fresh
per-operation monotonic deadline<=300000ms is independent of the expired engine
budget. Cancellation/deadline fences work but retains issued originals/sinks.

Derive the same relative UUID components under both roots:
organization/workspace/run/attempt, with upload token as basename. Never use an
engine relativePath as storage authority. Mutations require a non-NULL durable
writer UUID and transferring/publishing eligibility; reads require published state
with no writer. Validate versions, ordinals, offsets, expected length and SHA256.

prepare reconciles the same existing token, or creates an absent empty staging
file only for fresh transferring state with offset0/identity=null. An existing file
under that initial state must also be empty; do not adopt an unexplained payload.
A known identity with missing native custody refuses rather than replacing it.
Native length must be between durable offset and expected bytes. Flush before a
recovered offset receipt. Never truncate an unexplained tail: an interrupted append
may have written it before losing its reply.

append captures1..65536 bytes before any copy/allocation beyond that cap. Require
request offset equal durable record offset; compare any already-written overlap,
then append only the remaining suffix. Refuse conflicting overlap, gaps, oversized
extent or unsafe arithmetic. Return the reconciled durable native extent after
file flush and successful closes, retaining the same token/identity. Only metadata
CAS can record progress; the byte receipt alone grants no SQL writer authority.

A staging identity is a SHA256 digest with a versioned domain over exact binding,
artifact ordinal/ID/token/expected length/SHA256, canonical root-pair names/stable
identities and file device/
inode/UID/GID/mode. Exclude append-mutated size/times/link count. Common physical
checks still enforce the exact allowed links and every current operation signature.
Publication runs the one shared physical promotion owner, full expected SHA256
and size, then returns a published identity including final size/mtimeNs/ctimeNs/
nlink1. That identity upgrade is permitted only by a published native receipt.

Recovery from ambiguous publication verifies the old staging identity against the
same inode under its deterministic aliases, then full content/hash before the
published identity upgrade. A published record requires its full identity to match;
read rechecks it before/after streaming bounded chunks to an awaited sink, with
original file signatures checked through close. Never bless a changed published
file by silently rehashing it to a new receipt. Zero-byte publication still requires
actual checked custody; prepare supplies its explicit fresh-create authority.

All receipts follow successful cached file/directory closes and matching post-close
named checks. Original close failure retains the job, token credit and namespace
lease, fences the whole store and makes close fail sticky. Result rejection is not
settlement. Metadata-worker loss stops new mutations without dropping those owners.

## Required process evidence

Use bounded task-owned child processes/files/IPC. While parent A owns an issued
file operation, terminate only its metadata worker; contender B must remain blocked.
Graceful close must hold the lock through delayed writes, flushes and descriptor
closes. Injected close failure must remain sticky. After confirmed SIGKILL exit,
B must reconcile the same file/token/hash, including ambiguous publication and
empty files. A rejected same-process duplicate must not release A's native lock.
Missing/replaced/symlink/hardlink sidecars or parents refuse without recreation.
These are required tests, not claims established by this design review.
