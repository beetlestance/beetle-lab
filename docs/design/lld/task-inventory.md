# Bounded native task inventory

Status: C3c read-only preparation locally implemented. No unlink, durable native plan,
cleanup receipt, ACK or refund. Parents: [runtime authority](runtime-retirement.md),
[shared custody](native-custody.md), [namespace](staging-namespace.md),
[plan values](cleanup-control.md) and [retirement](output-retirement.md).

## Authority and custody

The private TaskInventory owner takes a genuine current RuntimeAbsent capability
from the same physical Journal and verified installed root. Derive the sole runtime
name/path from that scope and installation; accept no caller path. Require prepared
C1 task state, reread exact durable retirement/current eligibility/task anchor, and
match namespace, original, task identity and (when present) runtime spec. Missing,
preparing or unreserved roots remain recovery work. Never adopt a current empty root.

Reserve shared cleanup credit and strongly attach the actual OutputLifetime before
capture; synchronously bind task scope before Journal/native awaits. The lifetime
retains every issued original and cached close. Public expiry/abort is distinct from
quiescence. A rejected file, enumeration or auxiliary close retains owner, scope and
credit; shutdown waits actual originals and reports unresolved close. The private
bootstrap port exposes prepare/status and closes inventory before revoking runtime
and producer owners. No HTTP route or caller-supplied native port is exposed there.

## Linux native adapter

Production requires Linux. Open installed root with DIRECTORY/NOFOLLOW, check its
exact anchored native facts and canonical spelling, then read/verify the installed
marker's exact identity, size/content digest and single-link custody. Task and child
opens use held-parent /proc/self/fd paths, NOFOLLOW and NONBLOCK; files/directories
must match before/after open. This bridge pins the parent, not an atomic snapshot.

Compare live descriptor fdinfo mnt_id to the installed root for the task and every
child, including files. Same-device nested bind mounts therefore refuse. These IDs
are current-operation observations, not persisted namespace identity. Auxiliary
fdinfo reads loop to EOF within4096 bytes; marker reads within1024. Both are owned
and cached-closed through the same lifetime.

Enumerate each pinned directory manually with Dir.read(), bufferSize1 and byte names.
Require exact valid UTF-8 roundtrip before constructing a path. Node's types narrow
the documented encoding option to text; the one native adapter cast selects byte
encoding, and every returned name remains unknown until Buffer validation. No async
iterator may introduce an automatic second close owner. Refuse invalid components,
controls, links, duplicate native identity, specials, foreign ownership and modes.
Directories require0700; regular single-link files allow0400 staged input or0600
output. Require all four original role anchors, and inventory the complete task.

Keep at most512 entries including task root, depth32,4096 UTF-8 bytes per relative
path and128KiB complete canonical plan. Check limits before overflowing child opens.
DFS retains both FileHandle and Dir per ancestor: conservative maximum71 simultaneous
handles including auxiliaries, and1539 retained cached-close records per operation.
Closed metadata/path storage stays bounded by those counts; four owner slots alone
are not a descriptor/RSS bound. Fixed operation budget is at most30seconds.

## Checked observation

Check descriptor identity and live directory/file size/mtime/ctime around reads;
after original closes, recheck named installed root/marker and every inventoried
entry. Other tasks may change installed-root child timestamps, so its durable native
identity is checked without treating sibling changes as this task's mutation.
Only after successful closes/final checks expose a canonical NativeCleanupPlan with
exact original, retirement digest and namespace/task identities. Values grant no IO
permission. Native directories intentionally persist identity without mutable times.

Owned0700 namespace custody and actual producer/read retirement exclude legitimate
writers. A privileged host can still mutate concurrently; no atomic filesystem
snapshot against that actor is claimed. Later destructive replay must first persist
this exact plan and revalidate it; it cannot build a new empty-root plan after loss.
No durable preparation state or deletion effect is added in this slice.

## Acceptance and sources

Genuine authority and role anchors; forged/revoked token; changed root/marker/mode;
links/specials/invalid names; nested same-device mount; count/depth/serialized overflow;
held late open after cancellation, failed FileHandle/Dir close, post-close replacement
and unchanged released metadata. Native Linux leaf proof is distinct from portable
fault seams and a composed Journal/cleanup/ACK qualification.

API behavior: [Node filesystem documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html).
Descriptor/mount observations: [Linux proc documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html).
The adapter's checked-observation limits are design inferences from these interfaces.
