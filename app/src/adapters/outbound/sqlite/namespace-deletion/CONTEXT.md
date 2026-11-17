# Namespace deletion
One BEGIN IMMEDIATE owns exact receipt replay, scoped version/quiescence, marker
funding, transition and acknowledgement. Every failure rolls back all work.
Folders are empty-only; an organisation with only retired workspaces is retired (migration 030). Workspace retirement retains contents,
root/settings, receipt/pin/history/custody originals; no native file effects.
Permanent 2048-byte markers fence entity/root/settings identity reuse; no refund.
workspace-retirement owns visibility, mutation replay fences and busy predicates.
Tests: app/test/storage/namespace-deletion*.test.ts, workspace-retirement*.test.ts.
