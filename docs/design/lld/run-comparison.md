# Bounded run comparison

Status: contract/client/backend HTTP and browser components implemented locally;
actual browser qualification remains pending.
Owner: application/run-comparison. No stored comparison, migration or execution.

## Request and identity

POST /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/comparisons
is an authenticated, CSRF-guarded read with no side effects or retries. Closed
RunComparisonRequest carries workspace scope,2..4 distinct ordered runIds and a
nullable metric selection. Scope must equal the route; canonicalize UUIDs before
checking uniqueness. The first run is the baseline. Every run must be terminal and
belong to that workspace; never skip a foreign/missing/nonterminal run. Return a
scoped404 or conflict without a partial comparison.

Selection uses shared RunMetricKey, one baseline metric identity: metric, kind, execute/engine scope and
closed phase/request/assertion tags. It comes from the existing baseline metric
catalogue; do not accept an ordinal as a cross-run semantic identity. Null selection
returns provenance/results/differences without reading metric bytes.

## Logical metric matching

Validate each pinned revision against Run.revisionId/suiteId/revisionDigest/scope.
Shared k6MetricLayout maps baseline rN/aN aliases to stable request ID and optional
assertion ID under that request. Resolve the same IDs separately in every revision;
reordering requests/assertions must not compare different logical work. A deleted
logical request/assertion is not_applicable. No copied compiler or alias allocator.
Unlabelled engine/aggregate series retain their exact kind/scope/metric identity.
Reject an invented baseline alias or a selection not in its trusted catalogue.

One internal metric lookup uses the existing archive owner, verified numeric
artifact and shared projection under its original admission/deadline. Do not page
through the full catalogue repeatedly or implement a second numeric parser. Return
one projected series and source manifest/measurement/coverage, explicit missing
series, unsupported/not-recorded source, or absent result. Never synthesize zero.
Request key and returned actual per-run identity remain visible. Histograms retain
estimate method/bounds; no percentile averaging, rate inference or outcome rules.

## Response and differences

RunComparisonSnapshot is <=262144 encoded bytes, with the requested workspace,
baseline ID, original nullable metric key, logical binding and2..4 ordered items.
Each item binds its full Run, optional authoritative result summary, environment
fingerprints, baseline differences, fixed warnings and optional metric evidence.
Copy engine outcome/completeness/execution/assertion-definition counts; missing
result is null. Sealed evidence does not override the Run's application outcome.

Environment contains target/input/secret-reference fingerprints (including inline datasets), known versus
unknown secret versions and configured/disabled target sampler. Never resolve
secret values. Target revision and actual contention remain unknown: matching
config/suite hashes cannot prove a stable target or idle environment. Compare
revision, engine image/profile, accepted budget/policy, target, inputs, secret
references and settings versions. Differences are facts, not an automatic claim
that runs are or are not scientifically comparable.

Config diffs carry at most100 changed JSON pointers per non-baseline run, with
added/removed/changed and an explicit limited flag. No config values, headers,
bodies, target URLs, secret locators or raw exceptions are returned. Use at most65536 visited nodes and4096 pending pairs per peer, depth64 and512
encoded bytes per pointer; a pointer that cannot be represented safely must be
reported as a limited parent/root change, never truncated into a different path.
Equal pinned revisions skip traversal only after bounded canonical config/input
content equality; contradictory equal pins fail. The baseline has no differences. Unknown secret version, target revision,
contention, sampler absence, missing/partial result and incomplete metric source
have fixed warnings. Do not hide missing data or a limited diff.

## Lifecycle and consumers

Use one service/request original, no queue/cache (one active comparison per
installation; admission is retained through physical settlement). Read at most four scoped Runs,
results and pinned revisions, sequentially; at most four metric lookups. Bound
revision bytes to existing1MiB configs/envelopes and transient four-run work; do
not send configs to the browser. A whole30s caller deadline covers metadata,
projection and final reconciliation. Internal metric lookup and comparison both return their actual original
promises; the HTTP owner supplies the fast cancellation race and retains the
original until metadata/native settlement. The shared metric owner remains exclusive. Abort/close fence new calls and await issued
originals; no timeout-based physical refund. Existing metadata/native owners retain
their limits. Recheck Run identity/version/activeAttempt and pinned revision after
source reads before publishing. State change or source mismatch fails explicitly.

Browser admission survives route/session remounts and retains exposed API originals
until settlement; the generated transport does not promise ignored underlying fetch
settlement. Retired renders/callbacks are fenced. Browser retains at most four selections in one workspace and clears them on
session/scope changes. A baseline catalogue page chooses one metric; returned
per-run ordinals/manifests/measurement times drive the existing bounded historical
sample/chart reader. Keep each run's source/time basis explicit. Config differences
show paths/count limits with links to owned revisions, not values or secret export.
Generated clients validate request uniqueness/route scope, ordered response run IDs,
terminal state, metric key and source/value/completeness relationships before use.

## Acceptance

Cover2/4/5 selections, case-folded duplicate IDs, wrong scopes, nonterminal/missing
runs, late replies/cancellation/held originals, exact byte limits and no writes.
Reordered/removed requests and assertions must preserve logical identity. Exercise
missing/unsupported/partial metric sources, histogram/rate/gauge values, unknown
secret versions and immutable accepted budget differences. Test bounded config
pointer traversal/limits and canary values never entering replies. Actual worker,
verified numeric files and authenticated HTTP prove integration; browser charts
and native export/save qualification remain separate claims.
