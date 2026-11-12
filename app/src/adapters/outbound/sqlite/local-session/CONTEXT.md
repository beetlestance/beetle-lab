# Private local browser session

Owner: installation-only LocalSessions, reached through Metadata.localSessions.
Contract: docs/design/lld/local-session.md automatic profile; migration014.
One exclusive metadata worker owns one row. No public query/resource exposes it.
CAS expectedVersion writes one next version; exact one-step replay returns that
same snapshot. Changed/stale originals conflict. Logout writes null, not a refund.
Credentials and replies<=2KiB, stored session<=1KiB; no unbounded maps/history.
Capture request before SQL and reply at worker/caller seams. Reject accessor and
malformed/negative-zero versions before serialization normalizes values.
No HTTP, clocks, randomness, logs, filesystem or automatic retries here.
Tests: app/test/local-session/{worker,application}.test.ts.
