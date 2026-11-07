# Workspace and folder browser

Public entry: OrganizationScope in index.tsx; accepts validated URL UUIDs.
Organization/workspace reads gate scoped lists; every query consumes AbortSignal.
Departed scope queries are cancelled and removed; runs are never cancelled.
Lists use one explicit page of <=100 items; inactive prior pages are removed.
No placeholder previous data. Public UUID semantics include case/URN parents.
FolderList renders flat displayPath rows; mutations send folder UUIDs and versions.
Parent UUID input avoids fetching an unbounded tree; backend validates ancestry.
Draft/replay owner: components/Editor.tsx. No deletes or synthetic default data.
Check: npx --no-install vitest run web/src --maxWorkers=2.
