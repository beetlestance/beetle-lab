# Protected retention controls

Penpot "Settings / Workspace / Retention preview" and "… / Retention progress".
Public entry RetentionControls({scope, run?, initialSnapshotId?}); workspace settings
and runs/result DeleteRun open it explicitly. Collapsed controls perform no reads.
Preview.tsx: heading, rule sentence, stat cards, first seven candidates then "…and N
more", "Never removed by this preview". Progress.tsx: removed count/bar, stage table,
one danger banner per blocked run (link to the run). Batches.tsx: saved batches.

Generated ApiClient owns closed schemas and route/request/reply binding. Every
mutation captures one request body/UUID; unknown outcomes permit only explicit
identical replay. Scope/API retirement aborts and fences callbacks without implying
rollback. Backend originals and cleanup ownership remain authoritative.

One bounded shared ReadAdmission serialises exposed API read promises, at most four
waiting intents with a five-second deadline. Run views share their gate; standalone
settings get an owned gate. Unmount cancels/removes scoped retention queries.

Batch inventory is at most eight. Apply admits the exact displayed nonempty batch;
any selection drift refuses the whole Apply (all or none). Expired previews cannot
Apply. Continuation selects the newly committed page. Status polls while applied and
visible. Counts and credit come only from status; "would free" is the logical byte
estimate, credit is "returned to the storage budget", never physical free space.
Explicit acknowledgement removes replay/status records.

Not shown (no API field): candidate suite and finish time (a getRun per row would
exceed the read gate), applied-at time, freed bytes per saved batch, discarded
batches (gone from the list), a dedicated retention route/breadcrumb (app-owned).
"Open diagnostics" opens the run page; no diagnostics deep link exists.

ParentRetentionControls in installation/org settings creates one live, partial
traversal window; it keeps the parent cursor/settings pin and an identical request
on unknown outcome; no parent Apply. The workspace link carries only the batch UUID;
workspace settings validate it, recover preview/status and require explicit Apply.
Empty parent responses are labelled non-durable; no installation-wide coverage.

Check: vitest run web/src/features/retention web/src/features/settings
web/src/features/runs/result web/src/app/settings*.test.tsx.
