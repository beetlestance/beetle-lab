# Organisation overview

Status: implementation contract for the selected dashboard parity slice.
Owner: overview read model, authenticated API and organisation landing view.

One organisation snapshot returns workspace count plus the existing folders/suites/
Run state counts,24 hourly UTC submission buckets,8 recent and20 active Run headers.
Headers include their immutable workspace ID for scoped links. Active records are
not engine liveness; failed outcomes and execution errors remain distinct.
Whole-organisation totals cover every workspace, independently of list pagination.

Resolve the organisation in the same SQLite read transaction. Aggregate metadata
only; no per-workspace/config/result/archive/agent calls or writes. Existing bounded
scalar projection semantics and clock validation apply. Fixed scoped ordering
indexes keep recent/active reads from materialising an installation-wide sort.
SQL counts may scan organisation metadata; constant-size replies do not promise
constant-time counts. No time-series/resource observation writes are introduced.

GET /api/v2/organizations/{organizationId}/overview uses the trusted server clock,
returns at most32768 bytes and validates scope/time/count/list consistency at worker,
HTTP/client boundaries. Missing/foreign organisation refuses. Malformed timestamps
make the snapshot unavailable, not invented zeroes. Client keys include organisation;
retired scope/session reads cannot render. Errors hide cached figures, with explicit
manual refresh and unknown state. No additional polling or mutating action.

Tests: multiple workspaces plus unrelated organisation, empty/missing scope,
UTC boundaries/future submissions, active/recent caps, wrong-scope/cross-list replies,
worker reopen, actual authenticated HTTP and UI scope/error retirement. Document
source/environment limits; no new native k6 or browser-visual claim follows.
