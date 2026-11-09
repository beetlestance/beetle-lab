# Input inventory

Public entrypoint: `InputInventory({ workspace: Workspace, renderActions? })`.
Uses the generated JSON API, shared input query keys and existing Beetle tokens.
Retains one page of at most 100 rows and at most 20 previous page cursors.
One explicit status panel owns one frozen deletion intent, including scope,
input ID, request ID and expected version. Unknown/accepted requests retain that
identity across status/list refreshes; replay is explicit and never automatic.
202 means acceptance; only the status read can establish deleting/deleted.
Unresolved requests lock panel departure; workspace/session departure aborts
requests, removes scoped cache and retires local state, ignoring late replies.
Definitive rejection can be cleared explicitly before preparing a new intent.
No upload, download, content reads, polling or persisted browser state.
The optional `renderActions(record)` slot receives only a successful selected
status read. It retires on selection/scope exit, during refresh/error and after
a write until a later status read; it never receives the paginated list snapshot.
Focused checks: `node_modules/.bin/vitest run web/src/features/inputs --maxWorkers=1`,
`node_modules/.bin/tsc -p web/tsconfig.json --noEmit` and
`node_modules/.bin/eslint web/src/features/inputs`.
