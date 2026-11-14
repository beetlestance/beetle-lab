# Automatic cleanup driver evidence

Status: local driver integration; later [composed native recovery](cleanup-composed.md)
and [agent crash recovery](cleanup-agent-crash.md) are separately qualified.
Basea222577. [Contract](../design/lld/output-deletion-runtime.md).

Migration023 adds an eligibility partial index without changing data. Discovery reads
<=32+1 physical candidates before ACK filtering with an independent canonical cursor
and captured horizon; ACK-only pages advance, and later passes discover new/deferred
work. The existing sequential child alternates file/retirement turns, admits exact
cleanup control before effects, and invokes the actual shared installation gateway.
File-only embedding requires an explicit isolated option before namespace acquisition.

The driver captures and validates exact requests/replies, persists only cleaned ACKs,
and defers pending or qualified transient failures. No charge is refunded. Metadata
carrier failures join actual worker termination; rejected termination remains pending
and prevents native namespace release. Independent review found this early-rejection
gap; the fix and held/rejected-termination regressions are included.

Initial focused22cases passed;12 new driver cases initially exposed synthetic fixture
clock/type problems, corrected without production clock or gate changes. The driver
cases then passed. Structural complexity findings were corrected by separating cursor
window capture, discovery, reservation and request binding; limits remain unchanged.
A frozen affected lane passed156cases/20files. Six TCP cases were denied ephemeral
loopback bind by the sandbox; only those affected cases were repeated with approval.
The six TCP cases passed15.15s;26 changed/installation cases passed7.12s,
including actual worker held/rejected termination and parent native-close ordering.
Types16.94s and lint6.93s passed. Final14 driver cases passed3.55s,
architecture9.89s, docs.42s and API build.76s all exited0. Independent review
accepted this scoped integration. No unrelated broad suite was repeated. Full logs/plans/source identity live privately
under .agent-work/cleanup-driver-c4g in the integration checkout after acceptance.

These tests use actual SQLite workers and native backend files; mock producer replies
qualify driver ownership/validation only. Agent Docker/native cleanup, authenticated
retirement HTTP and both workers still require one composed recovery acceptance lane.
No public retention/delete, settlement, tombstone, registry or user-service change is
claimed here. Existing25 unrelated baseline historical fixture failures remain recorded
in backend cleanup-control evidence rather than silently reclassified as green.
