# Organization browser

Public entry: `Organizations` in index.tsx. Uses the injected public API client.
Installation list pages are limited to 100; mutations include explicit request IDs
and optimistic versions. Query keys and cache policy live in app/queries.ts.
Inline drafts and unknown-outcome replay are owned by components/Editor.tsx.
No deletes, demo data, credentials, or automatic mutation retries.
Check: npx --no-install vitest run web/src --maxWorkers=2.
