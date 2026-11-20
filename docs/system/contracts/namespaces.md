# Namespaces

Organisations, folders and workspaces are deleted or retired by the backend alone; no
agent work is involved. Retained Run output is removed separately by
[retirement](retirement.md).

## Mutation refusals

Folder uniqueness is checked in the write transaction after scope, version and
placement validation; SQLite UNIQUE remains the final guard. A sibling collision
returns `conflict` with `fields: [{path: "/name", code: "conflict"}]`. Exceeding
8 levels (including moved descendants) returns `invalid_value` with
`fields: [{path: "/parentFolderId", code: "range"}]`. Other conflicts stay generic;
wrong owners stay `not_found`. Receipt replay runs before these checks. Only fixed
field paths/codes cross the worker and HTTP boundaries; no database text is echoed.

## Deletion and workspace retirement

Owned by `app/src/adapters/outbound/sqlite/namespace-deletion` and `workspace-retirement`.

| Target | Rule |
| --- | --- |
| Organisation | Refused while any workspace is active. No workspace: removed. Only retired workspaces: retired, like a workspace, and its slug freed |
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
- Migration 030 does the same for organisations: `retired`, with the canonical slug
  moved to `retired_slug` and the unique slug key set to `char(1)||id`, so a new
  organisation may reuse the slug. Its settings, receipts and retired workspaces stay;
  SQL rejects new workspaces or settings changes under it. Historical mode still reads it.
- Active or unresolved Run/export work and unfinished input intake refuse retirement;
  already-issued private work keeps its authority, new mutation and unissued Apply do not.
- Workspace- and organisation-scoped HTTP routes check visibility after authorisation,
  before body work (`app/src/adapters/inbound/http/workspace-visibility.ts`), except the
  exact workspace or organisation DELETE, so a replay still gets its original acknowledgement; the historical
  viewer uses its own read-only authority. SQL is the final guard.
- Organisation lists and overviews, counts, recent activity and retention discovery
  exclude a retired organisation or workspace; private delivery, cleanup and settlement reads skip the visibility check.
- Retirement itself frees no bytes. Reclamation (`retired-reclaim`, decision 034) has the
  backend begin the ordinary deletion intent for eligible terminal Runs of a retired
  workspace, at most 32 rows a turn. Files, ACK and settlement follow [retirement](retirement.md).
  Bytes are freed only at settlement; receipts, marker, replay floors and tombstones stay.
  Pinned, noted, retried, export-linked and legacy Runs are skipped and stay charged.

## Related

- [Retirement](retirement.md), [recovery](recovery.md), [inputs](inputs.md)
- [Decision 020: workspace retirement](../../decisions/020-workspace-retirement.md)
- [Decision 034: retired namespace reclamation](../../decisions/034-retired-namespace-reclamation.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/adapters/outbound/sqlite/namespace-deletion/` | `61ec0e63ba1e` |
| `app/src/adapters/outbound/sqlite/workspace-retirement/` | `bf734e210895` |
| `app/src/adapters/inbound/http/workspace-visibility.ts` | `89d870a75696` |
| `app/src/adapters/outbound/sqlite/retired-reclaim/` | `69408bf0b59b` |
