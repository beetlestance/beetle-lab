# Installation authority state

Public index owns explicit initialization/resume, ready-only serving and offline
restore facades. One process owner and one SQLite EXCLUSIVE connection fence all
other cooperative startup/restore owners until close; no job/event hot-path I/O.
The control file is outside every data path that restoration replaces.
Missing/corrupt/nonready state never becomes fresh serving authority automatically.
A restored authority is planned durably before data replacement; only exact
operation/installed-authority completion makes the gate ready again.
This component does not verify physical quiescence, copy data, initialize the
main journal or wire actual bootstrap. Its offline caller must prove those facts.
Synchronous store is bounded to16x4096-byte pages,64KiB cache, no mmap, one row and
short scalar projections. EXCLUSIVE locking and synchronous EXTRA retain startup
ownership and rollback-journal durability; hardware/OS qualification is separate.
No state file is deleted on errors. Failed close retains process ownership.
Caller supplies canonical private parent directory; final symlink/hardlink refused.
Focused check: `vitest run agent/test/installation-state --maxWorkers=1`.
