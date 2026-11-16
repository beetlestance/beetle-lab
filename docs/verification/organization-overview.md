# Organisation dashboard evidence

Status: reviewed local F01 cross-workspace implementation based on27a78f2.
[Contract](../design/lld/organization-overview.md). Packaged/browser/platform
qualification is separate from this source-local result.

The organisation landing view now shows every workspace’s aggregate metadata counts,
24 hourly submission buckets,8 recent and20 active record links. Headers carry
immutable workspace IDs. Counts span the organisation, not one workspace-list page.
It performs no per-workspace/config/result/native fanout or writes. Activity counts
submissions, not observed throughput; active records do not establish engine liveness.

The existing workspace projection and semantic/presentation owners are shared.
Trusted clock, canonical timestamps, state arithmetic, list order/caps and cross-list
identity are validated. Zero workspaces require zero metadata counts, and distinct
header workspace IDs cannot exceed workspace total. Request scope is detached/frozen
before any reader callback, so a reader cannot replace authority while returning data.
Errors hide cached figures; refresh is manual, without additional polling.

Migration027 adds only two organisation-prefix ordering indexes. Recent/active
query plans avoid temporary ordering; predecessor rows/charges survive and a late
index collision rolls back the schema. Scalar counts may scan organisation metadata;
bounded replies and header lists do not promise constant-time totals.

## Local evidence

- Final affected behavior:54 cases across11 files passed in26.19s, covering actual
  compiled-worker multi-workspace aggregates/reopen,33 records with25 active,
  UTC boundaries, missing/foreign scope, forged replies and mutating reader,
  shared workspace behavior, UI scope/error handling, namespace deletion and
  retention/settlement migration fixtures.
- Actual authenticated TCP/application/generated-client reads and backend reopen:
  two overview cases passed in3.60s. These enqueue one synthetic metadata Run;
  they execute no engine or target workload.
- Two migration/index cases and the configured-application route catalogue passed
  in the earlier composed lane; its separate failing fixture attempts are retained.
  All63 JSON operations are registered; this does not qualify every outcome.
- Final gates and source builds are recorded in the task’s source-bound check plan.
  Independent review accepted semantic fixes without repeating the test lane.

Initial failures were retained. The old workspace fixture used a raw SQLite
connection without registered validation functions; using the existing initializer
preserved its assertions. HTTP fixtures needed explicit capacity for the previously
introduced queued cleanup reserve and the owned TCP origin/transport. Client branch
complexity was factored without changing gates. No production policy was weakened.

No full suite, native-engine run, image build, user-service restart, deployment or
publication was performed. UI DOM behavior is not visual/accessibility acceptance.
