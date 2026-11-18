# Workspace and folder browser

Public entry: OrganizationScope in index.tsx; accepts validated URL UUIDs.
Organization/workspace reads gate scoped lists; every query consumes AbortSignal.
A `not_found` organization or workspace renders the shared NotFound, never an
empty dashboard. Departed scope queries are cancelled and removed.
WorkspaceList is the Penpot "Organization" table (+ Empty, Loading).
Lists use one explicit page of <=100 items; inactive prior pages are removed.
No placeholder previous data. Parent folders use a scoped named picker; the API
still accepts the documented UUID representations.
Workspace Overview contains its dashboard only. Folder create/rename/move/delete
live in Suites (FolderDialog, FolderActions and the bounded FolderPicker).
The global Workspaces link opens Suites when a workspace is selected; otherwise
it opens the organisation's workspace list. Overview remains independently reachable.
Check: npx vitest run web/src/app/mutations.test.tsx web/src/features/suites/boards.test.tsx.
