# Namespaces

Organisations, folders and workspaces are deleted or retired by the backend alone; no
agent work is involved. Retained Run output is removed separately by
[retirement](retirement.md).

## Deletion and workspace retirement

Owned by `app/src/adapters/outbound/sqlite/namespace-deletion` and `workspace-retirement`.

| Target | Rule |
| --- | --- |
| Organisation | Empty only: no workspace, including retired ones |
| Folder (non-root) | Empty only: no child, suite or input; root folder refuses |
| Workspace | Retired: hidden but retained with name, root, settings, history, receipts, pins and paid storage |

- One `BEGIN IMMEDIATE` reads the receipt first, then scope (wrong owner is
  `not_found`), expected version and quiescence. Exact replay returns the original
  acknowledgement; changed reuse conflicts; a fresh request for a retired one is `not_found`.
- Migration 026 writes a permanent marker ≤2048 bytes charged against installation
  storage; full capacity refuses atomically. Deleted entity, root and settings IDs,
  including case aliases, can never be reused. No marker expiry or refund.
- Migration 028 adds an irreversible retired flag and moves the private unique name
  key to a reserved value, so a new workspace UUID may reuse the visible name.
- Active or unresolved Run/export work and unfinished input intake refuse retirement;
  already-issued private work keeps its authority, new mutation and unissued Apply do not.
- Workspace-scoped HTTP routes check visibility after authorisation, before body
  work (`app/src/adapters/inbound/http/workspace-visibility.ts`), except the exact
  workspace DELETE, so a replay still gets its original acknowledgement; the historical
  viewer uses its own read-only authority. SQL is the final guard.
- Overviews, counts, recent activity and retention discovery exclude a retired
  workspace; private delivery, cleanup and settlement reads skip the visibility check.
  "Cleanup complete" means visibility or metadata retirement, never freed bytes.

## Related

- [Retirement](retirement.md), [recovery](recovery.md), [inputs](inputs.md)
- [Decision 020: workspace retirement](../../decisions/020-workspace-retirement.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/adapters/outbound/sqlite/namespace-deletion/` | `9a2881fbfa8e` |
| `app/src/adapters/outbound/sqlite/workspace-retirement/` | `b29edc4bed46` |
| `app/src/adapters/inbound/http/workspace-visibility.ts` | `b15cd03f4404` |
