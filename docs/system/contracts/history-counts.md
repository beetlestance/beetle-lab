# History counts and page ranges

`listRuns` optionally takes `includeCounts=true`. Ordinary list reads, comparison
metadata reads and command search do not request or compute the projection.
The flag enriches a response, not its selected rows; it is excluded from cursor
membership identity but included in the browser's query-cache identity.

## Snapshot semantics

The existing history transaction captures workspace name, keys, summaries,
contexts and optional counts together. `counts` contains safe nonnegative integers:

| Field | Meaning |
| --- | --- |
| `all` | Runs in the current suite/name/UUID-prefix context, before lifecycle/pin chips |
| `running` | Those whose stored state is `active`, not all unfinished work |
| `passed`, `failed` | Those with the corresponding stored outcome |
| `cancelled` | Those with stored state `cancelled` |
| `pinned` | Pinned runs within that context |
| `matched` | Runs matching every requested filter, excluding the cursor |
| `before` | Matching runs at or before the cursor in the requested sort direction |

A nonempty page displays `before + 1` through `before + items.length`, out of
`matched`. Pages are current snapshots, not an immutable browsing session:
concurrent creation, deletion, notes, names or outcomes can change the next range.
An empty continuation never displays a reversed range. Without counts, the UI
shows its ordinary page position and omits numeric badges rather than inventing zero.

The generated client binds page rows, next-cursor presence, known chip totals,
matched count and before count. Impossible totals or a foreign scoped page fail.
An error hides cached counts and mutable names until an explicit successful retry.

## Bounded selection and aggregation

Page keys and counts share one captured search selection. Existing budgets remain:
256 suite/folder candidates, 256 verified note matches, 257 prefix reads with an
explicit overflow refusal, and at most 256 pins. Suite and note matches are
unioned without double-counting. All caller values stay bound SQL parameters.

Counts aggregate only indexed scalar run metadata. Each actual aggregate statement
returns at most 28 state/outcome groups, including its exact cursor-side count.
Selected suites use their covering history index; workspace reads use the scoped
state/outcome index. Grouped state/outcome, timestamps and integer results are
validated before projection. No metric, config, artifact or engine read occurs.
Aggregate work scales with matching indexed rows; bounded output is not a promise
of constant-time counting. Query-plan tests execute the exported real statement.

Pinned search first selects its bounded pins. Note matches are checked directly
against those pins, so unrelated global note postings cannot reject the page.
This also fixes older pinned-name selection omitting matching run notes.
Optional global count discovery is separate. If only that wider prefix/note
context exceeds its search budget, the page still succeeds without `counts`, with
`countsUnavailable: "search_too_broad"`. The UI explains that narrowing the search
is required for totals. Other failures are not suppressed; partial counts are
never returned. Unpinned broad searches keep their existing explicit refusal.

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/adapters/outbound/sqlite/run-search/` | `96cf60874fda` |
| `app/src/adapters/outbound/sqlite/run-reads.ts` | `b72b1b69b123` |
| `contracts/src/api/run-list-page.ts` | `dd72ba836665` |
| `contracts/src/api/client/input.ts` | `c762f1c76820` |
| `web/src/features/runs/history-range.ts` | `9e5d615fbb81` |
| `web/src/features/runs/HistoryFilters.tsx` | `4b44664b11a1` |
| `web/src/features/runs/HistoryHeader.tsx` | `34fa1ea25a54` |
| `web/src/features/runs/RunHistory.tsx` | `a05f3d72e370` |
| `web/src/app/queries.ts` | `725fc7c07eb0` |
| `web/src/components/Pagination.tsx` | `e750e5cd3deb` |
