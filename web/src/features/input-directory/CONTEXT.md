# Directory inputs

Public UI: `index.tsx`; orchestration: `workflow.ts`; selection boundary:
`plan.ts`. `folders.ts` owns bounded namespace discovery and frozen creates.

At most 128 selected files, each 8 MiB and 128 MiB total; 128 folders,
128 KiB path metadata, eight folder levels including destination. Discovery
covers at most 2000 existing workspace folders across 20 pages.
One native File preparation/transfer at a time; no prepared batch buffers.
Empty directories are unavailable in browser FileList. The chosen root is kept.

No automatic write retry, overwrite or rollback. Unknown folder create retries
retain the exact intent. Input recovery belongs to the existing upload owner.
Cancellation/departure fence subsequent work; partial data can remain. Skip
retires only a paused file locally and can leave its partial backend input.

Checks: `vitest run web/src/features/input-directory`.
