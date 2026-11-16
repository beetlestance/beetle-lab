# Workspace overview

Status: F01 workspace scope; organisation/installation cross-workspace rollups
are outside this slice. Owner: overview read model, existing namespace authority.

## Contract

The existing workspace landing page keeps folders and adds an overview. Its one
explicit authenticated GET is workspace scoped. The generated response contains
scope, server generatedAt/windowStart, exact metadata counts, 24 hourly submission
buckets, eight recent summaries and at most twenty active summaries plus a more flag.
A summary contains only Run UUID, suite/revision UUID, requestedAt, state and outcome;
no configuration, environment, secrets, result bodies or full Run snapshots.

Use request time, not inferred execution start, for recent/24-hour activity. The
window is [generatedAt minus 24 hours, generatedAt). The trusted Run writer emits canonical millisecond UTC timestamps. Noncanonical
stored times make this snapshot unavailable rather than silently miscounting
lexicographic time ranges. A failed run has outcome failed;
execution errors are a separate count. Active means a record in active state,
not proof the engine/target is currently reachable. Queued/dispatching/finalizing
counts remain distinct. Future timestamps do not enter the activity window.

Counts aggregate all records in the exact workspace, independently of list-page
size. SQLite returns scalar/group counts and bounded summaries; no JavaScript
all-history materialization. Requested-time and state indexes support the bounded
lists. Migration016 adds those indexes only; it retains all existing tables/data.
The serialized metadata owner uses one read transaction for consistent counts,
buckets and links. Missing workspace yields not_found, never an empty dashboard.
Responses are validated and capped at 32 KiB. Inputs are fixed scope plus trusted
server time; clients cannot choose a scan range or large list size.

## UI lifecycle

Reuse namespace query hierarchy. Scope/run identities come from validated routes.
Show server snapshot time and manual Refresh; no polling or per-card requests.
A pending/error scope cannot show the previous workspace's cards; read errors show
unknown/error rather than zero. Generated-client ownership validation rejects a
foreign scope, duplicate IDs, invalid ordering, out-of-window buckets or mismatched
count/collection semantics. Page unmount follows existing namespace cleanup.

An empty successful workspace legitimately has zero counts and empty lists. Each
recent/active item navigates through the existing scoped Run route. Folder/suite
navigation stays visible; visual redesign is deferred.

## Acceptance

Test workspace isolation, missing identity, more than list limits, all state/outcome
counts, exact hourly boundaries/future timestamps, deterministic ties and a real
read snapshot. Check generated client foreign/invalid response rejection, actual
HTTP authorization/response and SQLite worker transfer, migration15→16 preservation
and query indexes. UI fixtures cover loading/error/empty/refresh, scoped late replies,
links and bounded requests. Run affected types/lint/generation/docs/architecture,
one web/API build at freeze; no Docker or native browser qualification is implied.
