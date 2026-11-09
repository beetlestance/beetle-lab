# Verified input download

Public entrypoint: `InputDownload({ record: InputRecord })`.
The inventory supplies an authoritative selected published status snapshot.
Consumes the shared `useInputTransfers` context; absent context hides the control.
One in-flight read retains its abort controller until the original promise settles.
Cancel, full record identity/version changes, context replacement and unmount fence
late replies. Component departure never closes the shared client.
Only verified success with exact expected 0..8MiB bytes creates a bounded Blob and
one object URL. A temporary standalone buffer is also at most 8MiB. No bytes are
cached; URL ownership ends on replacement, record/context departure or unmount.
Download input prepares the verified file; Save file requires explicit activation
and uses an ASCII input-UUID.bin name. Failures expose safe client messages or
fixed fallback text, with explicit read-only retry and no automatic work.
Focused checks: `node_modules/.bin/vitest run web/src/features/input-download --maxWorkers=1`,
`node_modules/.bin/tsc -p web/tsconfig.json --noEmit`,
`node_modules/.bin/eslint web/src/features/input-download`.
Component fixtures do not qualify browser/proxy or actual session integration.
