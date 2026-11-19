# Verified standalone export download

The Ready dialog, workspace export table and individual job use one shared
`VerifiedExportDownload` control. Publication remains a backend fact; the browser
checks the retrieved bytes before offering a save. Nothing is fetched on render.

## Byte selection and bounds

A click captures the ready publication's exact byte count, SHA-256 and scoped
export-content path. The reader uses a same-origin GET with credentials,
`redirect: error` and `cache: no-store`. No caller URL or native filesystem path
enters the selection. Non-200, redirected, oversized, truncated or mismatched
responses cannot produce a save URL. Body cancellation and reader-lock cleanup
are awaited, including failures.

The shared byte reader preserves the downloaded bytes, including a UTF-8 BOM.
The script viewer alone applies strict UTF-8 decoding and retains its 1 MiB limit.
Downloads admit the native export maximum of 64 MiB through an explicit
`export-script` response profile. Other artifact callers keep the existing 1 MiB
default; history keeps its separate API bound. Every body retains the existing
4096-fragment ceiling. The reader owns one bounded buffer; hashing uses that
buffer, and Blob creation copies it without text decoding or re-encoding.

## Original lifetime and save custody

Only one export download original is admitted across controls; there is no queue,
polling or automatic retry. A 30 s abort deadline requests cancellation. The slot
is retained until the issued fetch, body cleanup and hash work actually settle;
an ignored abort cannot admit another download early. Every continuation checks
its abort signal before returning bytes.

A control binds its API/session, organisation, workspace, job and publication.
Retirement aborts it and hides previous state immediately. A retired result cannot
create a Blob URL or request a save. At most one checked save URL is retained
across export rows/dialogs; starting another releases the previous URL and its
control's fallback. Closing or retiring its owner revokes the URL.

The control requests a browser save only after verification, using the original
bytes and fixed `suite.js` filename. A checked fallback link remains if automatic
saving does not start. A refused handoff shows that fallback and an explicit
message. The UI says size/SHA are checked and saving was requested, never that a
file was saved successfully. The browser owns the final filesystem operation.

## Evidence scope

Tests cover mismatch, truncation, metadata limits, original retention during
ignored fetch/hash aborts, original BOM bytes, retirement and shared URL custody.
Browser download acceptance verifies the saved fixture bytes independently.
These proofs do not qualify a newly built frontend image or a native publication.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/exports/script-bytes.ts` | `b5f1a8ab6f19` |
| `web/src/features/exports/scriptText.ts` | `d5e7ac244ac6` |
| `web/src/features/exports/VerifiedDownload.tsx` | `7e5d1fdbf5d3` |
| `web/src/lib/response-body.ts` | `253992da68f6` |
| `web/src/features/exports/ExportDialog.tsx` | `83fa0323e3e3` |
| `web/src/features/exports/ExportsTable.tsx` | `0d1892c56502` |
| `web/src/features/exports/Job.tsx` | `97a3808af9c3` |
