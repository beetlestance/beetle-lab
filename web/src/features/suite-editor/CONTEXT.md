# Suite editor

Boards: Suite / Edit, Request, Run setup, JSON, Save revision / Errors, Save
conflict, and Tablet / Suite / Edit. `suites/RevisionEditor` mounts the editor on
`?tab=edit`. `useSuitePage` owns `view=run-setup|json` and `request=<stable id>`;
view changes push history. Back/Done never save; the editor stays mounted.

Canonical config text lives in `useRevisionDraft`, bounded by `suites/draft` to
1 MiB UTF-8 plus JSON depth/collection limits. `ConfigFields.set` reports rejection;
forms remain available after a refused edit. Discard resets child inputs and
intake errors. Unknown config fields pass through unchanged.

`raw-drafts` owns unfinished body/scalar JSON across routed views: aggregate 1 MiB
UTF-8, at most 4,160 entries, keyed by unique request/check IDs. They block both
save paths and never enter the canonical config. Standalone JSON parsing rejects
trailing members; scalar checks reuse bundled engine schemas. Valid edits clear
raw buffers only after canonical acceptance. Removed IDs/body modes retire their
buffers; whole-editor discard clears them. Problem pointers follow current indexes.

`validate` supplies friendly blockers; `serverProblems` maps API fields to DOM IDs.
Context cards use actual draft IDs/paths. Current local/catalog blockers disable
saving; server field refusals stay resubmittable. Every problem jumps to its field.
`useInputCatalog` lists 100 published
inputs and reads at most 64 referenced inputs, naming missing/deleted files.
First-scenario stages stay on the main form; extra scenarios keep full controls.
Run setup edits secret bindings and file/inline/range datasets. Seconds fields
store exact integer milliseconds; secret values are never read by the editor.

About metadata and config share one version/receipt transaction. `useRevisionSave`
freezes the version; only acknowledgement or an explicit conflict choice advances
it. Acknowledgements keep later edits. `metadata` refreshes untouched fields.
Conflict copy includes config, metadata, message and any unfinished JSON text.

`useInputColumns` discovers file columns sequentially with exact parser kind,
hash/size checks, scoped query ownership and cancellation on retirement. No automatic
overload retry; explicit retry targets failures only. Unknown shape stays explicit.
The palette inserts known data/secret references at the current text selection.

Checks: `npx vitest run web/src/features/suite-editor web/src/app/suites.test.tsx`.
