# Storage settlement

Process-local coordinator for authenticated agent compaction. Read
`docs/design/lld/output-settlement.md` before changing ownership.

Two entries are reserved before input capture/preflight. Read-only eligibility
precedes the shared local fence; the transaction independently revalidates it.
Cancellation removes unissued fence waiters while preserving native leases.
Issued metadata retains ownership through completion or actual worker termination.
Unknown termination keeps the entry/fence. No timeout authorises a refund.

Stop unissued waits before Root shutdown; close joins issued work before Journal
close. The Journal owns accounting, tombstones and the fixed transactional purge.
