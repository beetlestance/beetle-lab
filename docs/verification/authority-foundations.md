# Journal and installation authority foundations

Status: independently reviewed foundations/startup, integrated and locally verified.
Foundation source: `e0c270dd305a6767f1ea1a0548bafcd5fac117ba`.
Startup/correction source: `4638d5e640ddcd62c719c377ae5c2eafc1a604d9`.
Runner wire source: `752d9d37835a9f14b99c68777f4aac88ae499b83`.
Backend binding source: `6378d213a0302cb12f7652156ba893b128534482`.
Connected dispatch is covered separately by [delivery runtime](delivery-runtime.md).

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

## Installed startup ownership

The actual RuntimeOwner opens the ready control gate before foreign verification
or journal recovery. It awaits the opened journal UUID, checks cancellation and
asserts the exact binding before configuration, composition, publisher or scheduler
startup. Missing/nonready/mismatched authority never triggers an initialization
fallback. The gate closes only after all service/monitoring originals and the
native journal close succeed. Cleanup failure retains runtime/control ownership,
including unknown acquisition cleanup before a facade could be returned.

## Actual checks

Foundation integrated command: `node node_modules/vitest/vitest.mjs run` with installation-state
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

The startup/correction source passed 72 tests across six gate/bootstrap files in
31.43 seconds, plus global Node TypeScript and scoped lint. Independent startup
review found one post-acquisition native-read cleanup gap. A real child fault test
reproduced the leaked lease on the original code; unchanged test/runtime bytes
passed after moving the final state capture inside its cleanup guard. Removing
the extra factory read moves that injected third read to owned initial binding;
the observable failure-cleanup/retry contract is unchanged. The follow-up review
closed the finding. These checks do not exhaust every native I/O failure location.

## Runner wire and integrated verification

Capabilities publish the actual journal UUID. The backend gateway captures one
canonical expected UUID into its private header; all five attempt routes reject
missing/malformed/mismatched authority before service work. Scoped missing receipts
have a dedicated reason and validated attemptId. Engine Offers remain unchanged.
Independent agent/schema and client reviews found no blocking source defect.
The no-lookup regression relies partly on source ordering; the engine-reason
separation and byte-preservation conclusions also include source inspection.

Exact integrated source above passed `NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2`,
exit 0: 3,963 tests / 374 files, 495.83 seconds for the test phase. Schema generation,
all configured TypeScript/lint/architecture/docs checks and frontend build passed.
The existing frontend chunk-size notice remains. This is local verification,
not Docker, browser, native architecture or completed backend delivery evidence.

## Backend immutable binding

Migration006 preserves existing execution records with NULL authority and refuses
adoption. New claims atomically pin the UUID from the original validated capacity
lease before possible delivery. Replay and acknowledged claims return the stored
binding after capacity drift or outbox deletion. Observations must match it before
merge, ACK or resource release. Indexed charged unbound ownership fences new claims.

The integrated binding source passed Node TypeScript, architecture (1,127 sources),
documentation (180 files) and 585 tests / 58 storage/capacity/bootstrap files,
exit 0, 94.59 seconds. Scoped handwritten lint passed on the review candidate.
This is scoped integration evidence; the full gate above predates backend binding.

Independent review found a SQL text-length NUL gap and a masked oversized-snapshot
oracle. Two new NUL cases failed against the original CHECK and passed unchanged
after adding an exact byte bound. Correcting the snapshot mock restored its intended
preconditions; removing the size guard then failed the getter oracle. A during-claim
UUID rotation test verifies complete custody rollback. Both follow-up reviews closed
the findings. These failure proofs do not establish automatic delivery or result custody.

## Limits and required next work

The integrated gate verifies the runner-wire source above; it does not qualify
release images. Earlier UI evidence remains in [run controls](run-controls.md).
Host is macOS arm64/Node 26.7; target Node 24/Linux amd64+arm64 qualification remains.
Process-crash tests do not prove hardware/power-loss durability. Arbitrary manual
rewinds and hostile concurrent path replacement remain outside the accepted model.

First-install tooling/CLI/Compose provisioning, compiled executable smoke,
delivery runtime, and physical cold-backup/restore proof remain required. The control store
alone does not verify quiescence, copy restored data or settle physical execution.
See [delivery authority](../design/lld/delivery-authority.md) and [PLAN](../../PLAN.md).
