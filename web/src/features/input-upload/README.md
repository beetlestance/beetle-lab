# Input upload

Public entrypoint: `UploadInput({ workspace: Workspace })`.
Uses the shared API and input transfer contexts and existing Beetle tokens.
One workspace/client mount owns one file and prepared payload (maximum 8 MiB),
one frozen create identity and at most one frozen seal identity. No file reads
occur outside the shared byte client. Chunks are sequential 64 KiB slices.
Every dependent write and completion follows immutable-bound authoritative status.
Failed operations stop; recovery is explicit create/seal replay, status, or Resume.
Publication acceptance is separate from confirmed published status.
Cancel aborts the local workflow; it does not claim backend rollback. Departure
aborts and ignores late results without closing the shared client. Local discard
never deletes backend data. Drafts are memory-only and retire on departure.
Folder selection retains one page of 100, history of 20, and one selected label;
the upload-specific query prefix has zero cache retention.
Focused checks: `node_modules/.bin/vitest run web/src/features/input-upload --maxWorkers=1`,
`node_modules/.bin/tsc -p web/tsconfig.json --noEmit`,
`node_modules/.bin/eslint web/src/features/input-upload`.
