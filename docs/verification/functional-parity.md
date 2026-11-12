# Remaining functional parity

Status: targeted audit updated through2e51b67; not complete release acceptance.
Authority: [feature inventory](../current-features.md) and
[acceptance matrix](../verification.md). UI redesign remains a separate later task.
This checklist records gaps that must not disappear behind broader feature labels.

| Inventory | Current source evidence | Required closure |
| --- | --- | --- |
| F01 dashboard | [Workspace overview](workspace-overview.md) has exact scoped counts, hourly submission buckets and bounded recent/active links | Workspace slice locally verified; cross-workspace rollups and native browser qualification remain separate |
| F02 namespace deletion | Generated descriptors exist, but the actual configured application has no organisation/workspace/folder DELETE routes or UI controls | Implement scoped, versioned deletion with child/input/run/cleanup protections; namespace listing/creation/rename do not establish deletion |
| F06 history controls | Paged history displays state/outcome but the current query is UUID-ordered PageQuery and the UI has no history filters/sort, duration or disk columns | Add indexed scoped history queries and truthful duration/storage evidence with integrated fixtures |
| F10 warnings | [Observed load guidance](load-advice.md) shows current-window/recorded drops and an explicit iteration-median VU heuristic | Consumer slice locally verified; native warning classification and configured-scenario guidance remain |
| F16 command search | [Contextual command search](command-search.md) shares namespace list pages and supports keyboard/focus/scope retirement | Locally implemented; native browser qualification remains |
| F17 embedded reference | [Reference/downloads](embedded-reference.md) use generated schemas, real binary route owners and a standalone agent skill; source-image HTTP verified | Locally implemented; broader browser/release qualification remains |

These are partial, targeted observations. They do not prove all other inventory
items are complete, nor require copying the legacy visual layout. Close each item
against its existing acceptance ID; audit the remaining inventory before R3 closes.

Other known open work remains: producer retirement, final retention purge/refund
(F14; [backend file driver](output-deletion-runtime.md) locally verified); delivery
restart/cold-restore authority; packaged automation/browser qualification; and R4
fresh/pull installs, native amd64/arm64, backup/restore, scans and bounded soak/
measured overhead. Focused local component evidence does not close those gates.

[Public export jobs/download](public-standalone-export.md) and [ordinary source
Compose](compose-first-boot.md) are now locally verified, including the default
offline profile. Published pull-install/release qualification remains.
Automatic loopback browser sessions and optional CLI connect are implemented;
packaged browser/image qualification remains. No service was redeployed by this audit.
