# Authoring metadata

Descriptive data people attach to suites, revisions and runs, plus the run times
the UI shows beside them. Shapes are in `contracts/api/v2/suite*.schema.json`,
`run*.schema.json` and `settings-*.schema.json`; general suite and history rules
are in [Public API](public-api.md).

## Suite description

- `description` is optional on `createSuite` and on `PATCH /suites/{suiteId}`.
  It follows name text rules (trimmed, 1 to 280 scalars, no control characters)
  and is stored as given after trimming; it is not searched.
- PATCH is version-checked like name and folder changes: an omitted description
  keeps the current one, `null` clears it, and any accepted change increments the
  suite version. A stale `expectedVersion` fails with `conflict`.
- Suites read `description: null` when none is set, including every suite that
  existed before migration 031.

## Combined revision save

- `createSuiteRevision` optionally accepts a closed, nonempty `metadata` group:
  name, same-workspace folder and nullable description, using PATCH semantics.
  Omitted fields stay unchanged; null clears description.
- The existing receipt transaction checks one suite version, validates destination,
  folded sibling name and config/input pins, appends the revision, and updates
  metadata plus its current pointer with one version increment. A late failure
  rolls back all state, search postings and the receipt.
- Metadata participates in the request intent, outside the config digest. Identical
  replay returns the original full revision before checks and never reapplies old
  metadata over newer edits. Legacy requests and full receipt shapes stay valid.
- A name collision is 409 with `/metadata/name: conflict`; a foreign folder is
  scoped not-found. No submitted value or raw database message is exposed.
- Next ordinal uses a scoped indexed seek with bounded SQL integer capture;
  corrupt ordinals fail storage, exhausted ordinals conflict, with no coercion.
- About fields and configuration form one browser draft. Its optimistic version
  stays frozen until acknowledgement or explicit conflict override. Refreshing
  untouched metadata never discards edited fields or silently advances that version.

## Revision stamps

- Each new revision records `savedAt`, `savedBy` and an optional `message`
  (`createSuiteRevision` request field, 1 to 280 scalars, name text rules).
- `savedAt` is the HTTP adapter's clock at acceptance, passed beside the request.
  It is not part of the intent digest, so a retried request with the same
  `requestId` replays the original revision and its original stamp.
- `savedBy` snapshots the installation's administrator display name when the
  revision is written. Later name changes never rewrite earlier revisions.
- Revisions are immutable, so the three fields are fixed at insert. A database
  trigger requires `savedAt` and `savedBy` together and refuses a message
  without them.
- Revisions created before migration 031 read `savedAt`, `savedBy` and
  `message` as `null`. Nothing is backfilled or inferred. The UI shows
  "not recorded" (or hides the field) for null values and never substitutes the
  suite's or run's time.

## Administrator display name

- The session model has a single administrator and no person record. The
  display name is the installation setting `administratorName` (common name
  rules), changed through the installation settings PATCH with its
  `expectedVersion`.
- It is optional; when absent it reads as `Administrator`. It labels revision
  stamps and run requests only and grants nothing.

## Run requester

- New runs snapshot `requestedBy` from the configured administrator display name,
  defaulting to `Administrator`, inside the existing admission/receipt transaction.
  It is a display label, not an authenticated person or IAM identity. Callers cannot
  supply it in `createRun`.
- The bounded optional field lives in the immutable run JSON snapshot; no schema
  migration or backfill is needed. Reads and original receipts without it remain
  unrecorded. Later settings edits never rewrite the snapshot or replayed receipt.
- Live and result context show the captured label, or `requester not recorded` for
  absent/null values, including restored history. They never read current settings
  to infer an earlier requester. The label never enters the engine Offer or intent.

## Run notes

Route: `PATCH /runs/{runId}/note` (`setRunNote`), body ≤ 64 KiB.
`createRun` also accepts an optional initial note: non-null notes and their search
postings commit with admission at note version 1; omitted/null notes stay unwritten.
The raw note participates in create receipt identity; replay preserves the original
note even after a later edit. Neither a second POST nor an engine Offer carries it.

- Request: `scope`, `requestId`, `expectedNoteVersion` and `note` (1 to 1000
  scalars, name text rules, or `null` to clear). The response is the full Run.
- A note has its own `noteVersion`, separate from `Run.version`: lifecycle
  transitions never conflict with an edit and an edit never changes the run's
  version or state. `noteVersion` is 0 until the first write; every accepted
  write, including a clear, adds 1. A stale version fails with `conflict`.
- The operation is receipted like other mutations: the intent digest covers
  `{kind, id, request}`, a repeated `requestId` with the same intent returns the
  original Run, and a different intent fails with `conflict`.
- Notes are never deleted; runs are never deleted either. Clearing keeps the
  version count. Under a retired workspace or organisation the write is refused
  as `not_found`, like other new mutations.
- Every Run read (`getRun`, `listRuns`, cancellation and note responses, new
  `createRun` responses) carries `note` and `noteVersion`. Receipts and snapshots
  written before migration 031 omit them, so the fields are optional in the
  schema; clients treat absence as `null`/0.

- New note writes record server `noteUpdatedAt`, including clears; initial notes use
  admission time. It is display data, never ordering/CAS authority or caller input.
  Migration 037 leaves older notes null; original receipts keep their original stamp.
- The browser freezes its opened version and draft through pending/unknown saves.
  Unknown outcomes allow identical replay only. Conflicts keep the attempted value
  (including clear), read the latest note, then offer Use theirs or a new
  version-checked Replace with mine; a failed read keeps the draft and offers retry.
  Restored history shows recorded notes and timestamps without editing controls.

### Note search

- The run-history `name` filter also matches a substring of the run's current
  note, with the same fold, length rules and budgets as names.
- Postings (`history_note_grams`) change in the same transaction as the note, so
  edits and clears apply at once. A note whose fold exceeds 4096 scalars is
  refused rather than truncated.
- The first query trigram whose posting list holds ≤ 256 runs selects
  candidates; each candidate's current note is then checked against the whole
  folded query. When every trigram exceeds the budget, the request fails 422
  `search_too_broad`; there are no partial results.
- Pinned-only reads check their bounded pin notes directly; unrelated global note
  postings cannot reject the page. Wider optional counts follow [their own contract](history-counts.md).
- Note matches and suite/folder/workspace matches are merged and deduplicated
  by run before ordering, filters and the cursor apply. `search_indexing` still
  reflects only the name backfill: every note postdates migration 031, so note
  postings need no backfill.

## Run times

- `startedAt` and `finishedAt` are the agent-observed `runtime.started` and
  `runtime.exited` event times of the run's active attempt, read from the
  durable event prefix only (`seq ≤ durable_through`).
- `finishedAt` is the first exit after the first start. A partial index on these
  two event kinds keeps the read at four rows per run.
- Both are `null` when the event is absent, not yet durable or was not
  retained. They are never estimated from `requestedAt`, state changes or
  backend clocks, and the agent clock is not corrected.
- They describe the runtime process, not the k6 measured duration that
  run-history summaries report.

## Migration 031

Adds `suites.description`, the three revision columns, `run_notes`,
`history_note_grams` and the runtime-event partial index. Existing rows gain
`NULL` only; the upgrade test checks that every predecessor row is otherwise
unchanged and that a late failure rolls back to the exact schema 030.

## Related

- [Public API](public-api.md), [Run lifecycle](run-lifecycle.md), [Run delivery](run-delivery.md)
- Decision [021: bounded history search](../../decisions/021-bounded-history-search.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/adapters/outbound/sqlite/migration037.ts` | `3c3834e4839f` |
| `web/src/features/runs/result/useRunNote.ts` | `e594c44a97e6` |
| `web/src/features/runs/result/useNoteConflict.ts` | `d798ff0bbcd6` |
| `app/src/adapters/outbound/sqlite/runs.ts` | `65bcf86f1368` |
| `web/src/features/runs/RunRequester.tsx` | `355e1373a20b` |
| `contracts/api/v2/run.schema.json` | `15d4a6199c19` |
| `app/src/adapters/outbound/sqlite/suites.ts` | `d70508594376` |
| `app/src/adapters/outbound/sqlite/migration031.ts` | `b0feac9a7325` |
| `app/src/adapters/outbound/sqlite/run-annotations.ts` | `5f43a315db31` |
| `app/src/adapters/outbound/sqlite/run-notes.ts` | `071cca795034` |
| `app/src/adapters/outbound/sqlite/run-search/notes.ts` | `417df874f6f1` |
| `app/src/application/runs/note.ts` | `f121f12fc4d4` |
