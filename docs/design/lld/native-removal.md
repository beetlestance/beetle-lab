# One durable native removal step

Status: C3e private single-step removal locally implemented. Journal019 progress.
Parents: [plan storage](cleanup-plan-store.md), [inventory](task-inventory.md),
[retirement](output-retirement.md) and [runtime authority](runtime-retirement.md).
No public route, physical receipt, backend ACK or quota refund.

## Current authority and durable preparation

One coordinator per physical Journal accepts a genuine current RuntimeAbsent and
verified root. Reread exact retirement eligibility/prepared task metadata and the
same immutable stored plan. Match scope, namespace/task and retirement request;
never invent a new plan from the current directory or accept a caller path/cursor.
At most64 scoped entries; exact concurrent calls share their actual original promise.
Capture one fixed <=30second budget before awaits. Scope/capability/budget checks
follow foreign reads and precede every subsequent native/metadata effect.

Journal019 adds one bounded progress row per stored plan. Canonical progress <=8192
bytes and encodedBytes+512 logical row charge use the existing reserved buckets.
No prior row, spool/hold charge or ceiling changes. Shape/plan/count/version and
monotonic transition guards reuse the cleanup-control codec. Update/delete of plan
identity, skipped/rolled-back transitions and progress deletion refuse; exact replay
is allowed. Raw progress is metadata, never proof of filesystem work.

Begin persists prepared/version1/count0 only. Under the shared cleanup lease, verify
COMPLETE current prepared inventory against the persisted plan, with no missing
entry allowed. Only then commit cleaning/version2/count0. Strictly repeat the
presence check under that same lease before the first effect. A disappearance in
this fresh continuation refuses; it is not reclassified as an earlier uncertain unlink.
After a crash with cleaning already committed, its durable state authorizes recovery
of only the exact next reverse-order entry's uncertain absence.

## One native effect

Use the existing Linux descriptor/marker/mount inventory adapter. Compare the complete
current remaining inventory against the SAME plan: every removed suffix entry must
stay absent, all remaining entries match, and only the next reverse-order entry may
already be missing on resumed cleaning. Unknown/reappeared entries, another missing
entry, replacement inode, link, special, mount or overflow refuses before effects.
All four C1 role anchors remain metadata authority; roles already removed must not
be required to exist physically. Directory identity/ownership is durable, while
size/link count/timestamps are live mutation guards with expected deletion changes.

A missing task root is valid only for its own final turn (all other entries removed),
or a files_absent recheck. It still requires the full positive chain and exact
installed root/marker, with parent sync and closes. Generic ENOENT/404 gives no grant.

Hold verified parent descriptors, check plan-native identities/live mount membership,
open/check the exact leaf with NOFOLLOW/NONBLOCK, and issue one unlink or rmdir through
that held-parent /proc/self/fd path. No recursive/force removal. Sync the actual parent,
close every original through OutputLifetime's cached close, then recheck surviving
parent identities, installed marker and exact leaf absence. Only that successful
post-close result can advance one progress version/count. The final step produces
files_absent progress; it is not a physical cleanup receipt.

Each operation reuses shared cleanup admission/exclusion, inventory512/depth32/path4096/
plan128KiB bounds and bounded byte enumeration/fdinfo reads. Conservative handle
bounds are71 simultaneously open and1650 retained cached-close records per step,
including prepared revalidation plus removal parents/auxiliaries. The initial
prepared transition performs two sequential inventories, so its retained close-record
ceiling is3200; open descriptor maximum stays71. Serialization stays bounded by the
existing plan/control caps. Resource/RSS release qualification remains separate.

## Original settlement and recovery

Serialize an original through ACTUAL progress-carrier settlement, not just native
close. A held commit reply cannot permit a second unlink. Worker failure awaits its
existing termination barrier; unproven termination retains the coordinator entry.
Failed native close keeps its shared owner/scope/credit permanently and fences retry.
No timer/abort releases an issued original. Shutdown drains these owners before
inventory/runtime/producer owners or Journal release; unknown custody refuses close.

An unlink/rmdir/fsync error after a committed native effect does not advance progress.
After actual original settlement, retry revalidates the same stored plan and may
reconcile only its next entry's absence, including sync and original closes again.
A lost progress reply reopens the same row after carrier settlement. No second
native effect crosses an unresolved transition. Fresh genuine producer/runtime
barriers permit cold recovery without restaging or repeating target create/start.

This design assumes exclusive owned0700 namespace custody and retired legitimate
writers. It is not an atomic compare-and-unlink against a privileged host mutator;
the descriptor bridge pins parents but cannot eliminate final leaf-name replacement.
Cold mailbox association lost between container/volume removal still remains
conservatively unresolved. Full C3/C4 release proof and final settlement are pending.

Acceptance includes prepared/cleaning ordering, exact-next-only missing/reappearance,
held native/progress originals, fsync/close failures, complete file/directory/root
removal, compiled progress lost reply/reopen/migration/accounting and fresh genuine
cold recovery. Native Linux leaf proof is distinct from the compiled runner/backend
cleanup chain and its future receipt/ACK.
