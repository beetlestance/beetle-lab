# Workspace and folder browser

Public entry: OrganizationScope in index.tsx; accepts validated URL UUIDs.
Organization/workspace reads gate scoped lists; every query consumes AbortSignal.
A `not_found` organization or workspace renders the shared NotFound, never an
empty dashboard. Departed scope queries are cancelled and removed.
WorkspaceList is the Penpot "Organization" table (+ Empty, Loading).
Lists use one explicit page of <=100 items; inactive prior pages are removed.
No placeholder previous data. Public UUID semantics include case/URN parents.
FolderList renders flat displayPath rows below the workspace overview until the
Suites folder list (package B) replaces it; mutations send folder UUIDs and versions.
Workspace Inputs navigation lazy-loads the scoped input inventory.
Draft/replay owner: components/Editor.tsx. No synthetic default data.
Check: npx --no-install vitest run web/src --maxWorkers=2.
