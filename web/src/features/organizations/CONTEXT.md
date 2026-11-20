# Organizations

Public entries in index.tsx: `Home` (the `/` and `/workspaces` redirect, or the first-run
screen when no organization exists) and `useOrganizationEditor` (create and rename in the
shared Editor). Manage.tsx is rename and retire on Settings / Organization. There is no
organization list page; the header switcher in app/shell lists them. Create opens the new
organization. Mutations send explicit request IDs, and rename and retire send the read
version. Inline drafts and unknown-outcome replay are owned by components/Editor.tsx.
No demo data, credentials, or automatic mutation retries.
Check: npx --no-install vitest run web/src --maxWorkers=2.
