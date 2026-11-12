# Workspace overview

Status: reviewed local F01 workspace implementation; native browser and release
qualification remain. Base b279a09; source is the commit containing this report.
Contract: [workspace overview](../design/lld/workspace-overview.md).

## Implemented behavior

The workspace landing page retains folders and adds exact scoped metadata counts,
eight recent submissions, up to twenty active record links and 24 hourly activity
buckets. Counts cover the entire workspace, independently of history pagination.
Activity uses submission time, including its lower time boundary and excluding its
upper boundary/future requests. Failed outcomes and execution errors are distinct.
Active records are explicitly not physical liveness evidence. Root folders count.

One authenticated generated-client GET serves a consistent SQLite snapshot. It
returns only scalar/group counts and bounded lean summaries, capped at 32 KiB.
Requested-time/state indexes serve recent/active lists without a temporary sort.
The trusted writer emits canonical UTC millisecond timestamps; noncanonical stored
times make the snapshot unavailable rather than silently miscounting indexed ranges.

The UI shows server snapshot time and manual refresh. It adds no polling, per-card
queries, result/configuration reads or mutations. Failed reads hide cached cards
and show unknown, never zero. Foreign/late workspace replies cannot populate cards.

## Local evidence

The actual application composition, authorization, generated client and compiled
SQLite worker serve an authored workspace before/after enqueue and reopen. Exactly
one retained Run remains; reading the dashboard does not dispatch an engine.

The worker fixture includes 33 Run records, 25 active records, distinct lifecycle
states/outcomes, future requests, exact hourly boundaries and a separate empty
workspace. It proves whole-scope counts, eight/twenty list bounds and active-more,
correct buckets, missing-workspace rejection and continued reads after invalid time.

Original source migrations 1–15 create a genuine schema 15 fixture. Migration016
preserves all table rows and foreign keys, adds only the two indexes and advances
the version to 16. Query plans select both indexes without a temporary ordering
B-tree. An index-name collision rolls back to 15 without a partial new index; retry
succeeds after removing only the synthetic collision.

Client/HTTP/DOM cases cover authentication, trusted server clock, ignored range
query parameters, exact route scope, inconsistent counts/lists, duplicate summaries,
empty/error/refresh behavior, current-scope links and no extra requests from display.
Related namespace/shell, original-migration and all-operation binding regression:
79 cases in 6.91s. Final semantic client/HTTP/DOM selection: six cases in 3.48s.
Final application/worker selection: three cases in 7.34s. Backend/frontend types,
changed-file lint, generated API drift, architecture and docs gates passed. The
final API and web builds passed in 295ms and 584ms; the existing web chunk-size
warning remains. Earlier builds were repeated only after semantic source changes.
Native browser, image/runtime architecture and release evidence are not inferred.

Initial checks exposed a nonexistent browser-session fixture field, one JSON
import depth and Vite's unsupported variable migration import. Migration fixtures
now use explicit original source imports. A synchronous query rejection was changed
to match the asynchronous reader port. Lint found one complexity limit in shared
request-budget selection; the existing compact-request classification owns it now.
Independent review caught inconsistent recent/active summaries; shared client and
worker semantic checks plus regression fixtures now reject these contradictions.

## Limits

This is workspace scope. Organisation/installation cross-workspace rollups and
visual redesign are separate. Counts aggregate scoped database rows; they do not
materialize historical Run bodies or measure engine CPU/RAM. No user-service
restart, Docker rebuild, target traffic, deployment or publication occurred.
Schema 16 data cannot be opened by older schema 15 code; release rollback/backup
qualification remains pending. Source checks are local, not a hosted CI claim.
