# Decision 020: Deleting a used workspace retires it

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

DELETE on a workspace that holds saved suites, published inputs or terminal history
retires it rather than refusing or cascading. The workspace disappears from lists,
aggregates and public workspace-scoped access, but its canonical name, root,
settings, revisions, history, receipts, pins, replay floors and paid storage remain.
Retirement frees no bytes. A new workspace may reuse the visible name under a new
UUID; the retired identity never revives. Organisation and folder deletion stay
empty-only.

## Why

Terminal Runs, receipts and replay floors are the safety records that stop a late
Offer, delivery or settlement from recreating or double-charging work. Removing them
with the workspace would erase that authority before output cleanup and settlement
have run. Hiding the workspace gives users the deletion they asked for while
already-issued private work (delivery, cleanup, settlement, maintenance) keeps the
records it needs.

## Alternatives

- Refuse deletion of any non-empty workspace: rejected. Terminal history is paid,
  retained data rather than active work, so users could never remove a used
  workspace from view.
- Cascade delete rows and files: rejected. It would discard receipts and replay
  floors, race issued cleanup and settlement, and claim freed space before physical
  cleanup is proven.
- Rebuild FK-linked workspace rows to free the unique name: rejected. A private
  reserved uniqueness key achieves name reuse without rewriting retained rows.

## Consequences

Migration 028 adds an irreversible retired flag; a permanent 2048-byte marker
(migration 026) is charged and never refunded. Every workspace-scoped route and
fresh mutation command checks visibility; SQL rejects new user work under retired
scope. Physical reclamation is left to output retention and settlement.

## Review triggers

Organisation retirement was added on 2026-11-17 (migration 030; see
[namespaces](../system/contracts/namespaces.md)): an organisation whose workspaces are
all retired is retired the same way. Revisit if retained retired
workspaces become a material share of installation storage.
