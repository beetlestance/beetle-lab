# Durable staging namespace and cleanup capacity

Status: C1 implementation in progress; no physical cleanup/ACK or refund authority.
Parent: [retirement](output-retirement.md). Agent Journal migration016 is reserved.
Owners: staging native originals, Journal namespace/control rows, RuntimeOwner gate.

## Installed custody

Bind protocol1 installation/Journal authority and daemon identity to the canonical
bind source/target and mounted root's exact device/inode, UID/GID and mode. Native
device/inode values stay bigint internally and canonical uint64 decimal strings
on disk; UID/GID/mode use uint32 strings. Do not use mtime/ctime as identity.
Container ID/image and ancestor inode identities above the bind mount are not
persistent namespace identity: container recreation may legitimately change them.

Every startup revalidates canonical no-link ancestors through held descriptors,
compares named and descriptor identities, closes those exact originals and checks
the mounted root again. At most256 ancestors and two descriptors are held by one
native owner. Existing path bounds remain. Changed device/inode after a daemon/VM
recreation requires recovery; it is not permission to rebind to current paths.

The fixed .beetle-namespace-v1.json marker is <=1024 bytes, regular, single-link,
root-owned and0400. Its exact native identity and content digest join the durable
anchor. A Journal intent generates a namespace UUID and random nonce BEFORE file
creation. Only zero accepted history plus a genuinely empty installed staging root
can begin a new binding. Never adopt an unknown marker or manufacture an anchor
for retained history. Preparation/anchor/singleton caps are12/16/32KiB.

A pending fresh intent can recover only its exact expected nonce marker, through
bounded no-follow read, identity/content, file/root fsync and original-close checks.
Missing marker permits exclusive creation only while that fresh intent remains
valid. Unexpected entries or old evidence require recovery. The bound anchor is
immutable. Recheck the exact named marker after its descriptor close, after all
closes and immediately around commit/token publication. Read-time marker
mtime/ctime are transient mutation guards, not durable identity. Lost commit replies reconcile the same intent/proof, never another nonce.
Namespace values and codecs establish shape, not native IO proof.

RuntimeOwner retains the binding owner through result, actual drain and cached
closes. Startup binds it before admission configure, scheduler/publisher, providers
or intake. Failed close retains ownership; no fresh runtime is admitted. Only a
successful native/Journal binding installs the process-local verified-root token.

## Task preparation

Before mkdir, persist an immutable intent binding the exact original, purpose,
namespace identity, spec digest and sole derived runtime name. Preserve persisted
original UUID spelling. Native names retain their existing normalized hash mapping;
namespace/name uniqueness prevents aliased originals claiming one path.

Create task/input/output/secrets directories exclusively, fsync and recheck their
exact bigint identities, then commit all four roles BEFORE any provider writes.
Do not infer task ownership from names. Pending replay may attempt fresh exclusive
mkdir; an existing or partial directory stays recovery-required and charged.
Completed anchors never rebind; a second prepare cannot replay target work.
Intent plus anchor plus512 logical row allowance fit8192 bytes. This observation
record does not establish producer/read retirement, current absence or released IO.

## Reserved control capacity

Reserve196608 logical bytes/version1 atomically at admission for performance AND
export originals, before reservation/event insertion. Offered/unadmitted event-only
journaling retains its1024-byte quota path. Namespace binding is separately bounded
singleton metadata; full physical disks may still fail writes and stay charged.

| Future control bucket | Bytes |
| --- | ---: |
| Task namespace | 8192 |
| Retirement intent | 4096 |
| Native plan | 131072 |
| Progress | 8192 |
| Cleanup receipt | 4096 |
| Compact replay record | 4096 |
| Logical row/transaction allowance | 8192 |
| Total buckets / reserved slack | 167936 / 28672 |

Quota calculation and SQL guards include the FULL reserved amount, so ordinary
spool/projections cannot consume it. Control payloads consume their named buckets
inside that reserve and are not charged twice. C1 cannot zero/refund the reserve.
Legacy zero means positively unreserved, never zero cleanup debt or absence; old
history without trustworthy anchors refuses startup. No upgrade invents native
observations. The v14 projection explicitly describes its pre-control schema.

[Native plan/progress/receipt values](cleanup-control.md) freeze future bounds with
this reservation. Qualify actual maximum supported layout before accepting C1's
capacity. Increasing any enabled future bound requires a reviewed reserve/version
change before admission. Export capacity does not enable export cleanup. C5 still
owns replay retention/expiry and settlement before any purge or refund is enabled.

## Acceptance and remaining work

Required: exact integer/path/codec limits; compiled worker fresh/pending/bound
replay, lost replies, namespace/purpose/scope conflicts and legacy preservation;
full ordinary quota cannot consume reserve; actual four-root facts precede providers;
wrong/missing marker/root/link/ancestor and held/failed-close custody; startup gate
before every producer; actual128-input/64-secret maximum-name layout fit.

C2 producer/read drain, C3 actual persisted inventory/removal, C4 authenticated ACK,
C5 replay-safe settlement and C6 public retention/deletion remain separate. Component
or codec success does not establish these, browser/Compose/amd64 or release proof.
