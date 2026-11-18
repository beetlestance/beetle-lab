# Revision history listing

`listSuiteRevisions` returns immutable revision summaries newest first. Payload
shapes live in `contracts/api/v2/suite.schema.json`; revision creation and stamps
are owned by [authoring metadata](authoring.md).

## Pages and cursors

- `PageQuery` requires a limit from 1 to 100. Order is descending `ordinal`,
  globally across pages; UUID allocation order has no chronological meaning.
- `revision-ordinal-desc-v1` is a closed canonical base64url tuple binding the
  organisation, workspace, suite, limit, last ordinal and last revision UUID.
  UUID spelling normalizes to lowercase. Cursors grant no read authority.
- Application, worker and generated client validate query binding. Legacy UUID
  cursors, malformed tuples, changed limits and foreign scopes/suites are refused.
  Internal `invalid_input` becomes public `malformed_request`.
- Storage checks the bookmark UUID and ordinal together through a scoped primary
  key lookup. The ordinal is type/range checked inside SQLite before crossing the
  native boundary. Revisions cannot be deleted or changed.
- The initial indexed page has no ordinal predicate, so it includes the largest
  safe ordinal and does not silently filter malformed stored ordinal types.
  Continuations select `ordinal <= last-1`; both read `limit+1` rows.
  `ORDER BY suite_revisions.ordinal` refers to the stored column,
  not its validated projection alias, which would force a temporary sort.
- Replies bind every row to scope/suite, strictly descending ordinals, unique UUIDs
  and an exact continuation. A final row with a predecessor requires a full page
  and a continuation; `nextCursor: null` cannot silently truncate history.
- New revisions inserted between pages appear on refresh, not midway through a
  continuation. There is no snapshot or exact-total-count promise. The UI labels
  a partial header inventory with `+`, never treating MAX(ordinal) as a count.

## Predecessors and bounds

- Every `SuiteRevisionSummary` has `previousRevisionId`, nullable only when no
  earlier revision is recorded. It is the scoped revision with the largest lower
  ordinal; no ordinal-continuity assumption or history scan is needed.
- The query uses the existing `(suite_id, ordinal)` unique index and one scoped
  indexed predecessor lookup per selected summary. At most 46 ID characters cross
  the native boundary, so malformed IDs fail UUID capture without unbounded text.
  The trigger-maintained retained-run count remains a separate primary-key read.
- Adjacent summaries must agree with their predecessor links. A revision cannot
  point to itself; ordinal one cannot claim an earlier revision.
- The actual prepared SQL is exported for EXPLAIN tests, which require indexed
  outer/predecessor searches and refuse full scans or temporary sorting.
- The UI shows eight cards per page. Visible differences need at most nine
  distinct immutable configurations, each with the existing revision payload
  limit and scoped cache key. The header can own a separate current-revision read.
  A failed configuration read shows unknown differences, never “no changes”.

## Compatibility and recovery

- `previousRevisionId` is a listing projection, not stored revision content.
  Full `SuiteRevision` reads and mutation receipt replies keep their wire shape.
  Shared row facts feed separate full-content and summary schema capture.
- No migration or new index is required. Existing immutable history supports
  ordinal paging after reopen and in read-only restored installations.
- This change neither accepts mutations in restored history nor changes receipt
  lookup, metadata versions, configuration digests, input pins or retention.

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/src/api/revision-list.ts` | `787eea7fb68c` |
| `app/src/adapters/outbound/sqlite/suite-reads.ts` | `75149ae49455` |
| `app/src/adapters/outbound/sqlite/suite-row.ts` | `5b5b1cbcc0d6` |
| `app/src/adapters/outbound/sqlite/suite-validation.ts` | `015baa8d3d79` |
| `app/src/application/suites/query.ts` | `42b402ca1eb8` |
