# Suite authoring

Public entrypoint: `Suites`, scoped by organization and workspace, with an optional suite ID.
With no suite it shows `SuiteIndex`: top-level folders with FolderPage summaries, plus
workspace-wide name search. `?folder=<id>` shows `FolderView`, one folder's suites from a
server-filtered listSuites (group, engine, name and order), 20 per page. With a suite ID
it shows `SuiteDetail`, whose tabs are set by `?tab=edit|revisions`. `?start=1` opens Start run.
The editor view is `&view=run-setup|json` and one request `&request=<id>` (useSuitePage;
build links with `routes.suitePage`/`routes.suitesFolder`, never by hand).
Uses the paired generated API client and the shared route and query registry. Reads are
bounded: 100 folders or revisions, and 20 suites per folder page. Scope retirement aborts
reads and writes and removes scoped caches.
Draft config uses the shared bounded encoder (1 MiB UTF-8, depth and collection limits).
Invalid JSON stays local. The revision editor on the Edit tab (form, Run setup, JSON, save
panel, conflict overlay) lives in `../suite-editor`; see its CONTEXT.md. Writes freeze
request identity, body and version so an unknown outcome can be replayed. Server structural
preflight is distinct from engine validation.
Input references stay in configuration; this feature does not publish inputs.
Focused checks: `npx vitest run web/src/app/suites.test.tsx web/src/features/suites web/src/features/suite-editor` and
`npx tsc -p web/tsconfig.json --noEmit`.
