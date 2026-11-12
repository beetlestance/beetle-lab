# Remaining functional parity

Status: source audit at131a253, not complete release acceptance.
Authority: [feature inventory](../current-features.md) and
[acceptance matrix](../verification.md). UI redesign remains a separate later task.
This checklist records gaps that must not disappear behind broader feature labels.

| Inventory | Current source evidence | Required closure |
| --- | --- | --- |
| F01 dashboard | [Organization index](../../web/src/features/organizations/index.tsx) lists namespaces; [application routes](../../web/src/app/App.tsx) provide workspace/run views | Scope and implement required aggregate/recent/live-run navigation, with bounded scoped queries and an acceptance fixture |
| F10 warnings | Metric/history and comparison views exist; dedicated dropped-load/VU guidance was not found in run/result feature source | Prove dropped-load presentation and advisory guidance; label sizing as heuristic and retain unknown/missing distinctions |
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
