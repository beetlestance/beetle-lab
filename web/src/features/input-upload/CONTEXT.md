# Input upload

Public entrypoints: `index.tsx` (one-file UI), `workflow.ts` (bounded transfer
owner), `recovery.tsx` (explicit recovery actions), `FolderPicker.tsx` and
`scope.ts` (workspace/client draft identity).

One immutable file intent, at most 8 MiB prepared bytes and sequential 64 KiB
chunks. Unknown create/seal replays retain request identity; unknown chunks
require fresh status. Definitive creation refusals stop without overwrite.
Dispose fences callbacks and dependent writes; it never closes shared clients
or deletes backend data. Directory imports compose this owner one file at a time.

Checks: `vitest run web/src/features/input-upload`.
