# Workspace overview

Penpot "Overview" (+ Empty, Loading; phone and ultrawide layouts in overview.css).
One scoped overview GET under the workspace key, manual refresh only, no polling.
Errors hide counts and mean unknown, never zero; zero runs shows the empty board.
Recent labels come from shared first pages; the featured suite has one scoped read
so its name never depends on a partial list. Historical p95 comes from history summaries; published input count only when the
inventory fits one page. A failed or partial enrichment read says unknown.
Live card: newest active header; its scoped run polls every 2 s while visible,
stopping on error or terminal state. A failed read hides progress and current figures.
LiveProgress reuses the saved plan, bounded live reader and shared Progress; it keeps
one window, with explicit missing/stale readings and slowest-endpoint p95 labels.
Hourly bars use exact server outcome counts and expose the same counts as a table.
Agent reads `getInstallationStatus`;
unmeasured host values say "not measured". format.ts is shared with the
organization overview and command search. Contract: docs/system/contracts/web-ui.md.
