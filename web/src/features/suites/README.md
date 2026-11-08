# Suite authoring

Public entrypoint: `Suites`, scoped by organization/workspace and optional suite ID.
Uses the paired generated API client and shared route/query registry. Reads are
paged (100 items); scope retirement aborts reads/writes and removes scoped caches.
Draft config uses the shared bounded encoder (1 MiB UTF-8, depth/collection limits).
Invalid JSON remains local. Writes freeze request identity/body/version for unknown
outcome replay. Server structural preflight is distinct from engine validation.
Input references stay in configuration; this feature does not publish inputs.
Focused checks: `npx vitest run web/src/app/suites.test.tsx` and
`npx tsc -p web/tsconfig.json --noEmit`.
