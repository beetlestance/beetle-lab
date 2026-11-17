# UI packets: boards added on Nov 18

Status: active. Extends [ui-packets](ui-packets.md) and
[ui-packets-2](ui-packets-2.md) with the boards designed after the first gap map.
All live on the Penpot Screens page.

| Board | Package | Source | Notes |
| --- | --- | --- | --- |
| Settings / Installation: Administrator name | F | authoring metadata (031) | Shown as "saved by"; hide until 031 merges |
| Settings / Installation: Beetle version | F | installation read; upgrade proposal | "Check for upgrade…" hidden until the upgrade flow is built |
| Settings / Workspace: Preview removal, Retire workspace | F | retention preview; workspace DELETE | Retire refused → list from overview `active`, nonterminal exports, staging inputs |
| Settings / Field states | F | `allowedRange` on numeric leaves; settings save errors | Out-of-range, inherit pending, undo, save error, saved |
| Overlay / Retire workspace, / Refused; Retire organization / Refused; Settings / Changed elsewhere | F | `protected_dependency`, version conflict | Typed-name confirm for retire |
| Exports (workspace tab) | C | `listExports`, `cancelExport`, export content | No delete route: rows have Download, Cancel or Details only. The Exports tab is now on every workspace board |
| Add a sample file, / Name taken | F | none: client-generated sample, then the normal upload | Three fixed samples (users.csv, product-ids.csv, order-body.json); no backend work |
| Engines / Unavailable | F | `getInstallationStatus` agent state | Show for `unreachable`, `unavailable`, `stale`; link to installation status |
| Run result / Target by phase: memory chart | E | target-runtime artifact samples | Heap and RSS over the run with before/after bands |
| Phone / Run result | E | as Run result | Section list replaces the report tabs |
| Phone / Rename, Upload input, Retire workspace | A, F | as desktop | Dialogs become bottom sheets under 760 px |
| Tablet / Suite / Edit | C | as Suite / Edit | One column; the save panel moves below the form; field rows wrap |
| States / Controls (widened) | Wave 0 | – | Error column no longer clipped |

## Related

- [UI implementation plan](ui-implementation.md)
