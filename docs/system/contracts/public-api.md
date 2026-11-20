# Public API

The public JSON API under `/api/v2` is the only backend boundary for the web app,
automation client and agents following the embedded reference.
`contracts/src/api/` owns schemas, operation descriptors and the shared client;
`app/src/adapters/inbound/http/` registers routes; SQLite metadata enforces scope and versions.

## Operation catalogue

- `apiOperations` (generated into `contracts/src/api/generated/operations.ts` from
  `contracts/api/v2/http-operations.json`) owns every JSON route, method, parameter, query,
  request, response and success status. `apiSchemas` and `apiMessageSchemas` own payload
  shapes. No second endpoint list exists.
- Registration (`api-route.ts`) throws for any descriptor whose `implementation` is not
  `implemented`; `app/test/bootstrap/route-catalogue.test.ts` checks every descriptor
  against the composed routes. All current descriptors are implemented.
- Byte routes for input chunks and input/artifact/export content use `apiBinaryOperations` outside the JSON catalogue.
- `/healthz` is private. No SSE endpoint exists; clients poll event and live-metric reads.

## Conventions

- Validators reject unknown fields, coercion and defaults; only canonical decimal `limit`
  strings convert (`page-query.ts`). JSON bodies: 1 MiB default, input controls 64 KiB,
  suite revisions 2 MiB.
- Lists take an opaque `cursor` and a required `limit` of 1 to 100. A cursor is a position
  bound to scope and query, never a capability.
- Mutations carry a caller-owned `requestId` and, where they change existing state, an
  `expectedVersion`. Receipt lookup precedes version and state checks: the same intent
  returns the original result; a changed intent conflicts across operation kinds. 202 means
  accepted, not finished; reads are authoritative.
- UUIDs compare without case and persist lowercase; names and cursors keep case.

### Errors

`ApiError` is `{code, message, retryable, requestId, fields}` with a fixed message per code
(`api-errors.ts`); raw exceptions, config and environment values never appear. Only `conflict` and
`protected_dependency` add a fixed `reason` (`active`, `pinned`, `pin_limit`, `cleanup_in_progress`; [run pinning](run-lifecycle.md#pinning));
Folder fields: [refusals](namespaces.md#mutation-refusals); input delete adds bounded `dependencies` ([input metadata](input-metadata.md)). `no-store`.

| Status | Codes |
| --- | --- |
| 400 | `malformed_request` (schema, framework parse, bad URL) |
| 401, 403 | `unpaired`; `forbidden` (origin, host, CSRF) |
| 404 | `not_found`, including every wrong-scope lookup |
| 409 | `conflict` (version or intent), `cursor_expired`, `protected_dependency` |
| 413, 416 | `body_limit`; byte-range failure on content routes only (`invalid_value` body) |
| 422 | `invalid_value`, `search_too_broad` |
| 429, 500 | `rate_limited` (retryable); `internal_error` |
| 503 | `capacity_unavailable`, `storage_unavailable`, `search_indexing` (retryable) |

Creating a run returns 202 with `validationStatus: pending`. Semantic engine validation runs
under admission before target contact; a rejection becomes a durable run outcome, never a
later HTTP 422. Missing capacity or active isolation can hold the run in the queue. An initial note commits atomically ([authoring](authoring.md#run-notes)).

## Authentication and authority

One administrator per installation; no accounts, roles, invitations or SSO. Organisation views are not access control.

- Sessions: `POST /auth/local` (automatic mode) or `POST /auth/pair` (paired
  mode, single-use 15 min startup token) issue an HttpOnly, SameSite Strict
  cookie with an 8 h lifetime; `GET /auth/session`, `POST /auth/logout`. See [historical sessions](recovery.md#fresh-historical-restore).
  Exchanges are limited to 5 per minute. Logout revokes durably before replying.
- Guard: exact canonical `Host`/`Origin` (loopback, or one HTTPS origin with decision 032
  network access), no forwarded trust or CORS, CSRF on every mutation. A GET never
  grants access. Credentials never enter URLs, `localStorage` or public metadata. Bootstrap supplies the guard to every
  protected route; byte routes run it before reading a body.

## Hierarchy and scoping

Installation → organisation → workspace → optional nested folders → suites and
inputs. Folders group; they never grant permissions or create agents.

- Installation routes: organisations, installation settings, auth; the rest sit under `/organizations/{organizationId}`.
- Repository methods require scope; an object UUID alone is insufficient. The
  route resolves scope, never ambient state. Wrong organisation, workspace or
  parent returns scoped 404. Composite foreign keys enforce parent consistency;
  the client (`contracts/src/api/client/`) also checks every item's ownership
  (input usage binds page scope/ID; column discovery binds input/kind; the editor also checks hash/size).
- Folders: UUID plus `parentId` in one workspace; the root is a real folder and
  the only one with a null parent. Names are 1 to 128 characters (organisation
  names 1 to 48), unique
  among siblings by folded name; depth is at most 8 (`domain/namespaces/`).
  Moves stay in the workspace, check acyclicity transactionally and compare
  versions. Folder deletion requires emptiness; workspace/organisation retirement follows [namespaces](namespaces.md).
- Runs keep their suite's immutable scope; moving a suite never rewrites them.
  Captured [requester labels](authoring.md#run-requester) are display metadata; old absence stays unknown.

## Settings

Installation settings are complete values (shared pool, reserve, concurrency,
profiles); organisation and workspace store present overrides only, `null`
removing one to inherit; revisions and runs carry explicit values snapshotted
at acceptance and never changed afterwards.

- Resolution: installation → organisation → workspace → revision → run, then the
  installed ceilings; effective settings also require live runtime capability. Leaves carry their
  source. Installation PATCH groups replace whole groups; omitted groups stay.
- PATCH takes `expectedVersion` and returns effective settings and the new
  version. Out-of-range values fail; nothing silently clamps. A ceiling lowered
  below active reservations blocks admissions and drains; it never kills work.
  An increase beyond runtime-reported capacity is rejected.
- Retention is an atomic leaf, `manual` by default; preview and apply are explicit.

## Suites and revisions

Routes: `GET`/`POST /suites`, `GET`/`PATCH /suites/{suiteId}`,
`GET`/`POST /suites/{suiteId}/revisions`, `GET /revisions/{revisionId}`.

- A suite starts at version 1 with `currentRevisionId: null`. PATCH changes name, folder
  (same workspace) or description with `expectedVersion`; names are unique per folder by
  folded name. See [authoring](authoring.md), [suite listing](suite-listing.md) and [revision history](revision-listing.md).
- Creating a revision requires the current suite version, `engineId: k6`,
  `configVersion: 1` and a complete config ≤ 1 MiB. It atomically appends an
  immutable revision, optionally saves About `metadata`, increments the suite version
  once and moves `currentRevisionId`. Ordinals start at 1 per suite. SQL triggers block
  update, delete and `INSERT OR REPLACE` on revisions.
- `preflightStatus: passed` means shared k6 schema validation only.
- The input manifest is derived from dataset and body references, never
  submitted: at most 64 pins, deduplicated, conflicting pins rejected, each
  verified against a published input with exact scope, hash and size in the same
  transaction. Secret references stay opaque and unresolved.
- The revision digest covers `{engineId, configVersion, config, inputManifest}`
  only. Replays return the original full revision, never the current one.

## Run history

`listRuns` takes required `limit`, optional `state`, `outcome`, `order` (`newest` default,
`oldest`), `suiteId`, `pinned` (only `true`), and at most one of `name` or `runIdPrefix`.
Codecs: `contracts/src/api/run-list.ts`, `run-search.ts`, `run-history-summary.ts`.

- Order is keyset on `requestedAt` then run UUID, both in the chosen direction. The cursor
  is canonical base64url (≤ 512 characters; ≤ 1024 with `suiteId` or `pinned`) encoding a versioned
  tuple of scope, limit, filters, order, search fields and the last position. Any mismatch,
  alias or old UUID-only cursor rejects before storage. A short page has no next cursor.
- Pages read one snapshot but not an immutable history: state, outcome and current-name
  membership can change between pages. Refresh starts again.
- `name` is trimmed, NFKC-folded, lowercased and folded again: 3 or more scalars, ≤ 64 UTF-8
  bytes, no controls. It matches a substring of the current workspace, suite or ancestor
  folder name (never a joined path) or of the run's current note. `runIdPrefix` is 8 to 36 characters of UUID layout,
  matched from the start.
- Search budgets (`adapters/outbound/sqlite/run-search/`): at most 62 trigrams, 257 postings
  read per term, 256 folders and 256 suites, 257 prefix candidates. Overflow is 422
  `search_too_broad` before filtering; no partial results. Unprepared name indexes return
  503 `search_indexing`; each retry backfills at most 16 documents. Postings change in the
  same transaction as the namespace mutation, so new, renamed and deleted names apply at
  once; a folded name over 4096 scalars fails that write rather than truncating; an
  interrupted batch rolls back postings and checkpoint; a failed document leaves the
  workspace not ready.
- Every page carries `summaries`, the same length and order as `items`, each ≤ 2048 bytes
  and bound to run and active attempt; the page is ≤ 1 MiB. `availability` is `pending`,
  `ready`, `not_recorded`, `unsupported_format` or `unavailable`; unknown values are null,
  never zero. Duration is k6's measured test-run duration; RPS is execute HTTP requests
  divided by it; p95 is a histogram estimate. Published bytes are the verified catalogue
  sum; retained logical and metadata bytes come from the current attempt allocation.
  Listing never reads metrics or configs per row ([producer](results.md#derived-presentation)).
- `pinned=true` reads at most 257 pinned rows of the workspace, then applies the other
  filters; its cursor is a distinct tuple version, so it never continues an unfiltered list.
History pages may include the current workspace name. Optional `includeCounts=true`
adds exact snapshot counts/ranges ([contract](history-counts.md)); it never changes cursor membership.

## Run event reads

`listRunEvents` reads durable events of the run's active attempt.

- Limit 1 to 100; page ≤ 262,144 encoded bytes; each event body ≤ 65,536 bytes.
- The cursor binds scope, run, attempt, generation 1 and `afterSeq`; a foreign or future
  cursor is 400 `malformed_request`; an old attempt needs a fresh read.
- `resumeCursor` is the last returned sequence (or `afterSeq`); `nextCursor` equals it only
  while more durable events exist. `durableThrough` is the storage high-water, not
  completion. A queued run returns an empty pending page.
- Reads never ACK, refund or mutate. Corrupt stored events return `storage_unavailable`,
  never a shortened page. The client checks contiguous sequences and attempt binding
  (`run-event-ownership.ts`).

## Automation client

`app/dist/automation.js` in the backend image (entry `app/src/client/cli/main.ts`)
uses only this API: `connect`, `pair`, `run`, `status`, `result`, `cancel`, `compare`,
`export`, `export-status`, `export-download` ([guide](../../../site/src/content/docs/guides/automation.md)).

- Request files are closed wire schemas ≤ 4 KiB with caller-owned `requestId`; mutations
  are issued once and an unknown outcome prints the `requestId` for explicit replay.
  Session files are exclusive, 0600, owner-only, single-link, ≤ 4 KiB, bound to endpoint and origin.
- `--wait-ms` 1 to 3,600,000; reads every 2 s, at most 1801; never cancels or extends.
  `export-download` needs a ready job, writes `--out` new (`O_EXCL|O_NOFOLLOW`, 0600)
  and removes only its own file on a size, SHA-256 or I/O failure. No `validate` yet.

| Exit | Meaning |
| --- | --- |
| 0 | passed, acknowledged submission, successful read or ready export |
| 1, 4 | failed; cancelled (run or export) |
| 2 | invalid input or local file error |
| 3 | inconclusive, failed or unknown export, transport or invalid reply, unknown mutation outcome |
| 5 | still pending at the deadline, unavailable (including an unpaired or forbidden session), interrupted |

## Embedded reference

The web app serves `/reference` and four public static downloads from
`web/src/app/reference-downloads.ts`: `public-api.json` (operations, binary operations,
messages, schemas; ≤ 2 MiB), `public-api.md`, `beetle-lab/SKILL.md` and `k6-config.json` (≤
256 KiB). They need no session, read no runtime configuration and are fixed per build; a bad
source aborts the build. Development serves only GET and HEAD (others 405) with `nosniff`.
The viewer resolves only bundled schema IDs, never fetches a `$ref`, caps the filter at 128
characters and shows at most 80 matches.

## Related

- [Result presentation](result-presentation.md), [Engine metadata](engine-metadata.md), [Active history](active-history.md), [Inputs](inputs.md), [Web UI](web-ui.md), [Run lifecycle](run-lifecycle.md), [Resources](resources.md)
- Decisions [007: admitted validation](../../decisions/007-admitted-validation.md), [015: automatic local access](../../decisions/015-automatic-local-access.md), [021: bounded history search](../../decisions/021-bounded-history-search.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/api/v2/` | `6de77fe54add` |
| `contracts/src/api/client/` | `c16b8c7af732` |
| `contracts/src/api/run-list.ts` | `1c4b7b193309` |
| `app/src/adapters/inbound/http/api-errors.ts` | `9a79596d0e11` |
| `app/src/adapters/inbound/http/session/` | `4730d8aa11c6` |
| `app/src/client/cli/` | `c7eb756df145` |
