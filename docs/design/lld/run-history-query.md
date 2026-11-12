# Scoped run history parity

Status: proposed read-model contract, not implemented history controls.
Owner: Run query/SQLite reader and existing scoped history UI.
Inventory: F06; [remaining parity](../../verification/functional-parity.md).

## Current gap

The legacy history offered workspace/status/text filters and displayed duration,
requests, RPS, p95, errors and size. The new history provides bounded UUID-ordered
pages, state/outcome/validation and comparison selection. Metrics in Run detail
do not close the missing history presentation. Preserve the four-run comparison
cap and scope fences while completing this behavior.

## H1: first ready query/control slice

Keep one authenticated workspace-scoped list operation. Extend its owning query
contract with optional exact state and outcome filters and a fixed newest/oldest
requested-time order, default newest. Limit stays1..100. Unknown fields/enum values reject before
storage. Existing namespace navigation supplies workspace selection; never merge
unrelated organisations or fetch every workspace to filter in the browser.

Use keyset ordering on requestedAt plus canonical Run UUID as a deterministic tie
breaker, both in the selected direction. The cursor binds schema version, exact
organisation/workspace, limit, filters, direction and last time/UUID. Capture at
most4096 encoded bytes before decoding. Reject changed scope/query/limit, malformed
or noncanonical cursor and duplicate/out-of-order results. Reject the current
UUID-only cursor format; do not reinterpret it or silently restart pagination.
An explicit Refresh obtains a first page under the new query contract. Bind SQL parameters;
direction comes only from the closed enum, not caller SQL. Reuse/extend the existing
scoped requested-time/state indexes; record actual query plans before adding one.

Pages reflect a read snapshot, not an immutable all-history snapshot. A requested
timestamp/UUID cannot move, while state/outcome can change between pages. Refresh
starts a new first page. Document that state-filter membership can change; do not
promise exactly-once traversal across concurrent lifecycle transitions.

UI controls apply explicitly, reset the cursor and clear stale comparison selection
when scope/filter context changes. Canonical query keys include every applied field.
Late old-filter/scope replies cannot populate a new view. Share an identical query
only when every parameter matches; command search must not inherit hidden filters.
Errors hide stale data and offer explicit retry. No per-keystroke server query,
automatic mutation replay or extra metric/config/body request per history row.

Acceptance: real worker/HTTP generated-client fixtures with more than one page,
equal timestamps, both directions, every state/outcome, foreign ownership, query-
bound cursor rejection, lifecycle changes between pages and unchanged target count.
DOM fixtures cover apply/reset/refresh, late scope/filter replies, empty versus error,
comparison limit and request count. H1 alone does not close F06 summary/search.

## H2: verified summary projection

Before adding summary columns, define one lean source-bound history projection.
Reuse the existing verified metric/archive owner and exact global metric identities;
never add a second numeric parser or read an entire archive per visible row.
Prefer a durable bounded scalar projection from verified publication/indexing,
bound to attempt/generation/manifest and source coverage. Freeze its producer,
quota/migration, partial availability and restart behavior as its own packet.

Duration must name the actual measured phase/span and its authoritative clock.
RequestedAt-to-stoppedAt includes queue/setup and is not execution duration;
configured scenario duration is not an observation. Missing/unindexed/partial/
unsupported evidence stays explicit rather than zero. Request count, RPS and p95
must retain measurement scope, coverage and percentile-estimate semantics; no
percentile averaging or rate inferred from a configured request rate.

Size must distinguish verified artifact bytes and retained logical reservation
from measured filesystem allocation. Metadata allowances or source declarations
do not establish physical freed/used blocks. Join compact metadata in one read
snapshot; avoid100 native reads or result bodies for a100-row page. Define the
complete reply byte limit before enabling the projection.

## H3: bounded text/name search

Legacy substring search must not become first-page-only filtering presented as
all-history search. Choose and qualify a scoped bounded search-index owner before
shipping it. Bound input length, result page, cursor and update/recovery work;
search has no regex/SQL interpretation. Current suite names and immutable revision
identity are different facts: renaming a suite must not rewrite historical identity.
No unbounded LIKE scan, cross-workspace corpus load or silent result truncation.

H1 can proceed independently of cleanup after exact query/client/transport/schema
amendments are reviewed. H2 and H3 remain separate readiness gates; freeze their
interfaces before code. No new endpoint or migration ID is reserved by this draft.
Native browser and release qualification remain outside local component proof.
