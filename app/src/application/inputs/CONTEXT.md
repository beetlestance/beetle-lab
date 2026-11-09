# Input service

`createInputService` is the private entrypoint for metadata control, bounded chunk
append, verified content reads and one-page custody recovery.

Dependencies are the sole metadata `InputStore`, native `InputByteStore` and an
injected synchronous SHA256 intent digest. No concrete storage imports.

Create is metadata-only. Seal/delete return their original acceptance receipt;
status is authoritative. Only explicit deletion or deleting recovery removes bytes.
Metadata outcomes are never retried or compensated internally.

The service admits two byte owners globally and one per canonical input, with no
waiting queue. Original results, custody settlement and source/sink calls remain
owned after cancellation or response failure. Cleanup failure fences intake and
keeps close pending. Close aborts originals and waits for actual drain.

Recovery reads one page of at most 100, re-gets admitted rows, and counts custody
reconciliation rather than upload completion. Restart at the beginning after a
pass: state transitions may move work behind a cursor; page end proves no completion.

Focused check: `node_modules/.bin/vitest run app/test/application/inputs --maxWorkers=1`.
The tests use real isolated metadata and controlled byte jobs. Native filesystem,
HTTP composition and provider/Stager qualification belong to their owners.
