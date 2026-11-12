# Remaining functional parity

Status: source audit at131a253, not complete release acceptance.
Authority: [feature inventory](../current-features.md) and
[acceptance matrix](../verification.md). UI redesign remains a separate later task.
This checklist records gaps that must not disappear behind broader feature labels.

| Inventory | Current source evidence | Required closure |
| --- | --- | --- |
| F01 dashboard | [Organization index](../../web/src/features/organizations/index.tsx) lists namespaces; [application routes](../../web/src/app/App.tsx) provide workspace/run views | Scope and implement required aggregate/recent/live-run navigation, with bounded scoped queries and an acceptance fixture |
| F10 warnings | Metric/history and comparison views exist; dedicated dropped-load/VU guidance was not found in run/result feature source | Prove dropped-load presentation and advisory guidance; label sizing as heuristic and retain unknown/missing distinctions |
| F16 command search | Shell, breadcrumbs and theme picker exist in the application; no search route/control appears there | Implement keyboard-accessible bounded command navigation or record an explicit agreed scope change |
| F17 embedded reference | Shared schemas/API generation exist; application routes have no documentation/integration view | Connect generated API reference and the downloadable agent instructions; verify no private source or credentials enter downloads |

These are partial, targeted observations. They do not prove all other inventory
items are complete, nor require copying the legacy visual layout. Close each item
against its existing acceptance ID; audit the remaining inventory before R3 closes.

Other known open work remains: standalone export admitted lifecycle and public
workflow (F15); producer retirement, retention/delete orchestration and final
purge/accounting (F14); ordinary one-command Compose provisioning (F18); delivery
restart/cold-restore authority; packaged automation/browser qualification; and R4
fresh/pull installs, native amd64/arm64, backup/restore, scans and bounded soak/
measured overhead. Focused local component evidence does not close those gates.

The staged export engine composition is now locally verified, including exact
assignment/Offer binding, original build retention, native script verification and
non-extending staged deadlines. It has no public enqueue/download API yet.
Automatic loopback browser sessions and optional CLI connect are implemented;
packaged browser/image qualification remains. No service was redeployed by this audit.
