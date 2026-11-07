# Wrapper control journal

Public entry: `index.ts`. The shipped ControlEvent schema and bounded encoder own
envelope semantics. This boundary never executes children or produces a result seal.

`createControlWriter` takes a trusted directory, immutable scope and 1 KiB–64 MiB
quota. It exclusively creates `control.ndjson` (0600, regular, single link), syncs
file and parent, and refuses any existing path, including failed initialization.
`append` accepts a draft without seq, snapshots and validates it, assigns contiguous
seq 1–65536, completes short writes and syncs before returning a frozen event
eligible for notification. Frames include LF in the 64 KiB limit and quota.
One append may be issued at once; there is no queue. Uncertain I/O poisons the
writer. Validation/quota failures before I/O do not consume a sequence.

Each create/append/replay requires an explicit performance.now() deadline at most
60 seconds ahead and optional AbortSignal. A timer bounds caller waiting; checks
after I/O stop late replies from returning events or issuing further work. The
caller must stop the attempt after append failure. `close` is idempotent, rejects
new work, suppresses in-flight notification eligibility and quiesces issued I/O
before closing. An unresponsive kernel operation may delay cleanup; timeout does
not cancel a kernel write. There are no background retries or implicit handlers.

`replayControl` opens read-only, snapshots length, scans at most the quota and
65536 records with two 64 KiB buffers, and returns at most 100 events/256 KiB
of source frames. Every complete source line is schema/scope/sequence validated,
including outside the returned page. Corruption throws a fixed typed error with
no successful batch. Missing LF exposes `torn_tail` and preserves the prefix.
Future cursors fail. `complete` concerns only the byte snapshot; durability is
unverified for live files. Recovery never resumes append, repairs or reruns work.

The staging owner must supply a resolved absolute non-symlink directory owned by
this UID, without group/other write access, and prevent untrusted concurrent
directory/path replacement. Ancestor identity, mount trust and access control are
staging responsibilities. File checks do not authenticate arbitrary cross-process
writers. Durability assumes the host filesystem correctly implements file and
directory fsync; power-loss and platform guarantees require separate qualification.

Check: `NODE_OPTIONS=--max-old-space-size=1024 npx vitest run engines/k6/test/wrapper-control --maxWorkers=2`.
