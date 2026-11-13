# Lifecycle baseline repair

Status: independently reviewed scoped checks, Node24 worker and native arm64 composition passed.
Base:a7279ba, after [C1 namespace/control](staging-namespace.md).

## Reproduced behavior and correction

Five failures in four files reproduce on clean44a95b8 independently of C1. The
baseline25-test probe ran14.19s; original failures remain in private evidence.

Docker observation used to await mailbox-volume verification before retaining a
checked container identity. A concurrent old404 could therefore publish missing
while the positive response was suspended. Retain the positive identity first;
volume failure still returns unknown and cannot authorize launch or recreation.
Publication continues checking current identity and terminal/removal fences. The
existing race assertion remains, with an additional held/failing-volume regression
that proves a subsequent missing observation cannot issue another create.

Clock-integrity stop, SQL facts and source-free closure already preserve the actual
durable cause. The common runner reason enum omitted clock_integrity, so valid
closure construction failed schema validation and surfaced as Journal unavailable.
Add that enum value and regenerate runner/API registries. Agent tests verify the
actual committed absence; the backend's authenticated TCP/compiled Metadata test
preserves its reason through final projection and reopen. Never substitute a setup
failure or invent a wall timestamp. The consumer check additionally exposed the
old runs.reason CHECK; [migration020](../design/lld/clock-reason-migration.md) relaxes
only that metadata constraint and keeps every row, index and trigger. Older
strict consumers may reject the new reason: qualify matching components together.

Two callback-retirement assertions expected eviction after native close despite
unresolved durable closure and a charged reservation. They now assert the exact
entry remains charged, while still requiring issued callback/cancellation drains
and exactly one controller close. A cancellation-before-admission assertion expected
installation-closed error; it now requires exact rejected/cancelled progress and
preserves zero preparations and null allocation. These correct stale expectations,
not production behavior or charge-release policy.

## Checks and limits

Initial three-file correction passed18 tests. A direct native diagnostic isolated
the clock schema error; its failure log is retained and the diagnostic source was
removed before the accepted test lane. No failure was suppressed or test disabled.

Frozen runner/API drift, node/web/engine runtime types, lint, architecture and docs
passed. The99-file affected lane had1150 pass/2 fail in140.85s; preserve both
failures. Binding the existing workspace-overview vector and adding020 corrected
them:8 tests in2 files passed. Changed history/migration consumers passed26 tests
in9 files (25.52s). Another stale current-schema artifact assertion was corrected;
its3 native artifact tests passed. Reuse the97 unaffected passing files, rather
than repeating that lane after fixture corrections.

Migration020's9 native cases passed: real001–019 run/attempt rows, all schema/root
pages/rows/FKs preserved, actual history summary/publication/charge preservation,
commit and post-CAS reparse rollback, unexpected/overbound DDL, missing transaction/
FK protection and startup-connection retirement. Initial diagnostic fixture and
canonical-path fault-injection failures remain recorded; assertions were retained.

A separate offline Node24.22.2/SQLite3.53.4 container ran the actual compiled metadata
worker against a real019 database. It became ready, closed normally and committed
20 with every synthetic row and other schema object/root page unchanged; FK check
passed. This886ms command qualifies the pinned runtime API rather than assuming
local Node26 behavior. Worker input SHA256 is retained privately.

Agent/API/engine/frontend builds passed. Source26b5750449fb9f3e746033ea7a3d44434fe8fb7b
produced matching agent/engine images. Their native arm64 application→agent→k6
composition passed in13.19s command time. One readiness and one work request,
zero unexpected requests, six verified artifacts, numeric4 history summary and
metadata reopen passed. Exact retained allocation and runtime CPU/RAM/PID controls
were verified. The bounded builder and task containers/network were removed.
Engine-log capture remains unavailable in the fixture diagnostics; its failure is
retained, not clearance. User services were not restarted.
The all-agent217-file C1 lane is reused for unaffected boundaries; no duplicate
whole-suite run is implied. A context note exceeded40 lines and was shortened;
its original docs-gate failure remains in the record.

No producer cleanup/read-retirement API, native deletion, cleanup ACK, tombstone,
cleanup refund, push, publication or user-service restart belongs to this packet.
C2–C6 and final browser/Compose/platform/soak/release acceptance remain open.
