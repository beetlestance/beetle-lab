# Workspace overview

Penpot "Overview" (+ Empty, Loading; phone and ultrawide layouts in overview.css).
One scoped overview GET under the workspace key, manual refresh only, no polling.
Errors hide counts and mean unknown, never zero; zero runs shows the empty board.
Labels come from shared first pages (reads.ts, same keys as list views and command
search): suite names, p95 and run start time; published input count only when the
inventory fits one page. A failed or partial enrichment read says unknown.
Live card: newest in-progress header; elapsed from `Run.startedAt` only. Live rps,
p95, failures and the stage plan stay on the live run page. Hourly bars are one
colour (buckets carry counts only). Local agent reads `getInstallationStatus`;
unmeasured host values say "not measured". format.ts is shared with the
organization overview and command search. Contract: docs/system/contracts/web-ui.md.
