# Output deletion command

Public entry: prepareOutputDeletion; private port output-deletion-metadata.ts.
Owner contract: docs/design/lld/output-deletion-store.md.
Closed<=4KiB command snapshots scope/run/request/version and validates UUID/time.
Shared namespace mutation digest excludes newly allocated ID/time for exact replay.
No SQL, native IO, refunds or lifecycle ownership. SQLite owns eligibility and
receipt-first transactions; native preparation must be persisted before removal.
Focused checks: app/test/output-deletion/{store,guards,boundary}.test.ts.
