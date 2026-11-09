# Journal and installation authority foundations

Status: independently reviewed components, integrated and locally verified.
Source: `e0c270dd305a6767f1ea1a0548bafcd5fac117ba`.
Startup, runner wire binding and backend dispatch are not established by this report.

## Durable journal identity

Migration009 stores one immutable lowercase UUID for a newly created journal.
Schema/identity commit together. Normal reopen preserves it; distinct journals get
distinct UUIDs. Existing versions 1–8 receive NULL, including empty journals: absence
of attempts does not prove fresh physical history. Old data/charges/clocks/sequence
identities remain intact. No read automatically repairs or adopts an identity.

`Journal.journalAuthority()` traverses the actual journal worker and returns only a
validated canonical UUID. Missing/null/corrupt state returns `recovery_required`.
The bounded worker read projects at most two rows and 36 bytes per identity. Parent
validation fences malformed successful replies. SQLite guards refuse mutation,
deletion and replacement, including REPLACE/IGNORE/UPSERT attempts.

## Separate control store

The control-store component has explicit initializing, ready and restoring states.
Normal serving opens only ready state; initialization/resumption are separate
operations. Offline restore records its operation and planned fresh authority
before returning, and exact completion is required to become ready again.
Serving exposes no mutation methods. Its caller must bind the opened journal UUID
before any execution owner starts and hold the lease until all originals drain.

A retained process/native owner and SQLite EXCLUSIVE connection prevent concurrent
cooperative serving/restoration. A failed close retains ownership. The control DB
must remain outside every restored data path. Reads project at most two small rows;
main DB uses at most 16 pages of 4096 bytes, 64KiB cache and no mmap. Settings are checked.
The store refuses missing/corrupt/nonready state, final symlinks/hardlinks, changed
inodes and oversized files. It never deletes a state file to infer freshness.

## Actual checks

Integrated command: `node node_modules/vitest/vitest.mjs run` with installation-state
and the nine impacted journal test files, `--maxWorkers=1`: 99 tests / 11 files passed,
22.16 seconds. This combines 83 journal tests and 16 control-state tests.
Global Node TypeScript exited 0; architecture checked 1,118 sources and documentation
checked 179 files. Scoped production/test lint exited 0. Schemas and dependencies
outside these components are unchanged from the earlier full verified baseline.

Journal fixtures use compiled native worker threads and raw SQLite inspection.
They cover stable/independent UUIDs, old empty/nonempty quarantine, bounded/corrupt
reads, malformed parent replies, guarded mutations, migration rollback/COMMIT
failure, future schema refusal and preserved original graph/bytes/charges/clocks.
Existing test amendments update latest/future versions and precisely remove the
new table when constructing genuine prior-schema fixtures; no gate was lowered.

Control tests fork a real child that acquires the lease. Repeated parent opens
fail while it lives; SIGKILL followed by intact reopen succeeds. Killing a restore
owner preserves the exact operation/planned authority and blocks serving until
explicit completion. Other cases exercise close failure, corrupt singleton rows,
initialization interruption and exact restore identity checks.
Initial development failures were complexity lint and a digits-only uppercase
negative fixture; both were corrected. Neither is presented as a production red.
Independent reviews found no blocking source defect within the component model.

## Limits and required next work

This is not a full repository gate on this source; the earlier full gate remains
[run controls](run-controls.md). Component/Node checks do not qualify release images.
Host is macOS arm64/Node 26.7; target Node 24/Linux amd64+arm64 qualification remains.
Process-crash tests do not prove hardware/power-loss durability. Arbitrary manual
rewinds and hostile concurrent path replacement remain outside the accepted model.

The actual startup must acquire the ready gate, bind the opened journal UUID before
scheduler/publisher/intake, and retain it through shutdown. First-install tooling,
capability/header contracts, immutable backend claim/observation binding, delivery
runtime, and physical cold-backup/restore proof remain required. The control store
alone does not verify quiescence, copy restored data or settle physical execution.
See [delivery authority](../design/lld/delivery-authority.md) and [PLAN](../../PLAN.md).
