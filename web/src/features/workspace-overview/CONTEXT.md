# Workspace overview

Penpot "Overview" (+ Empty, Loading; phone and ultrawide layouts in overview.css).
One scoped overview GET under the workspace key, manual refresh only, no polling.
Errors hide counts and mean unknown, never zero; zero runs shows the empty board.
Labels come from shared first pages (reads.ts, same keys as list views and command
search): suite names and historical p95; published input count only when the
inventory fits one page. A failed or partial enrichment read says unknown.
Live card: newest active header; its scoped run polls every 2 s while visible,
stopping on error or terminal state. A failed read hides progress and current figures.
LiveProgress reuses the saved plan, bounded live reader and shared Progress; it keeps
one window, with explicit missing/stale readings and slowest-endpoint p95 labels.
Hourly bars are one colour until outcome counts are added. Agent reads `getInstallationStatus`;
unmeasured host values say "not measured". format.ts is shared with the
organization overview and command search. Contract: docs/system/contracts/web-ui.md.
