# Input metadata and usage

Facts about an input that are not its custody: when it was created and published,
how many rows and columns its verified bytes hold, and which suite revisions pin
it. The [inputs contract](inputs.md) owns identity, lifecycle and byte custody;
this page owns the derived fields on `InputRecord`, the usage read and the named
delete refusal. None of these facts grants or weakens any custody rule.

## Record fields

| Field | Meaning | Absent value |
| --- | --- | --- |
| `createdAt` | metadata-worker clock when the create committed | `null` for rows created before migration 032 |
| `publishedAt` | worker clock of the `publishing → published` commit | `null` until published, and for legacy rows |
| `rowCount`, `columnCount` | exact counts measured once from the published bytes | `null` when not computed, unsupported or over budget |
| `usedByCount` | exact number of revisions that pin the input | `0` |

- The server always emits all five; the schema keeps them optional so older
  snapshots still validate. Values are never estimated or backfilled: a legacy row
  keeps `null` times and no counts after any later transition.
- SQLite triggers (`migration032.ts`) require `created_at` on insert, keep it
  immutable, and allow `published_at` only on the publishing commit, where it is
  mandatory. A staging or publishing row with a publication time or a shape is
  rejected as corrupt on read (`input-row.ts`).

## Row and column counts

`app/src/application/inputs/shape.ts` counts; `reconcile.ts` runs it after the
publication commit, through the same verified read as a content download
(`contentSink`, byte reservation, hash before and during streaming). Publication
never waits on or depends on the count: any read, parse or store failure leaves
the counts `null`, and a conclusive custody failure fences the input exactly as a
download would.

| Rule | CSV (`.csv`) | JSON (`.json`) |
| --- | --- | --- |
| Parse | streaming strict RFC 4180, fatal UTF-8, BOM stripped | `JSON.parse` of one top-level array |
| Rows | records after the header | array length |
| Columns | header fields; every record must match | first object's keys, only if every element is a plain object with exactly those keys |
| Budget | ≤ 1,048,576 rows, ≤ 1,024 columns, 8 MiB input cap | ≤ 2 MiB bytes, ≤ 1,048,576 rows, ≤ 1,024 keys |

Other names, empty files, malformed content and anything over budget record no
shape. `input_shapes` is insert-once for the exact published identity (ID, hash,
size) and can never be updated or deleted. The counter mirrors the k6 dataset
rules but stays in the app: the architecture boundary forbids importing the k6
compiler.

## Usage read

`GET /api/v2/organizations/{o}/workspaces/{w}/inputs/{id}/usage?limit&cursor`
(`listInputUsage`) returns `InputUsagePage`: `scope`, `inputId`, exact `total`,
at most `limit` (1 to 100) `RevisionDependency` items `{suiteId, suiteName,
revisionId, ordinal, current}` ordered by revision ID, and `nextCursor`.

- The cursor binds limit, scope and input; any change is 400
  `malformed_request`. An unknown input or wrong scope is 404. The reply is capped at 256 KiB.
- `current` compares the suite's current revision at read time.
- The statement is driven by the covering index `input_pins_usage`
  (organisation, workspace, input, revision) with primary-key joins and no sort;
  a test asserts the plan of the real prepared SQL. The index replaces
  `input_pins_lookup` from migration 003.
- `usedByCount` and `total` read `input_usage_counts`, maintained only by the
  pin insert trigger. Pins are immutable, so the count only grows; triggers
  refuse any write whose value differs from the pin count. Migration 032
  backfills it from existing pins.
- The historical viewer allows the read; it never writes a shape.

## Delete refusal

Deleting a pinned input fails with 409 `protected_dependency` (previously
`conflict`). After the store refuses, the service reads the first
`INPUT_DEPENDENCY_PREVIEW` (10) blockers and raises `InputDependencyError`; the
error body adds `dependencies: {total, items}` only after it validates as
`ProtectedDependencies`. If that lookup fails or is empty, the plain refusal is
returned unchanged; the store decision stays authoritative.

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/application/inputs/shape.ts` | `6353d2a6697d` |
| `app/src/application/inputs/dependencies.ts` | `a1572a1cd7b4` |
| `app/src/adapters/outbound/sqlite/migration032.ts` | `b1809e633276` |
| `app/src/adapters/outbound/sqlite/input-usage.ts` | `0a3924115432` |
