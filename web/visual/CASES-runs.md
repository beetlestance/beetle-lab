# Run and settings screenshot cases

See [sections 1–4](CASES.md) for status and viewport keys.

## 5. Runs and live run — `specs/runs/`

- [x] runs — Runs — list with mixed outcomes — D P
- [x] runs-pinned — — — `?pinned=true` — D
- [x] runs-empty — Runs / Empty — D
- [x] runs-loading — Runs / Loading — D
- [x] pinning-states — Pinning / States — pin, pinned, pin limit reached — D
- [x] pinning-states-pending — Pinning / States — pin request in flight — D
- [x] pinning-states-unreachable — Pinning / States — pin request fails (500) — D
- [x] delete-run — Overlay / Delete run — checked run, reclaimable bytes, expiry, Keep and Delete — D
- [x] delete-run-pinned — Overlay / Delete run / Pinned — D
- [x] live-run — Live run — active run with live metrics — D P U
- [x] live-run-starting — Live run / Starting — D
- [x] live-run-waiting-for-capacity — Live run / Waiting for capacity — queue read — D
- [x] live-run-paused — Live run / Paused — D
- [x] live-run-reconnecting — Live run / Reconnecting — D
- [x] live-run-cancelling — Live run / Cancelling — D
- [x] live-run-finalizing — Live run / Finalizing — D
- [x] live-run-compare-tooltip — Live run / Compare tooltip — hover — D
- [x] live-run-download-open — Live run / Download open — D
- [x] live-run-script-picker — Live run / Script picker — D
- [x] live-run-ticks-01 — Live run / Animated 01 — live poll tick 1 — D
- [x] live-run-ticks-02 — Live run / Animated 02 — live poll tick 2 — D
- [x] live-run-ticks-03 — Live run / Animated 03 — live poll tick 3 — D
- [x] live-run-ticks-04 — Live run / Animated 04 — live poll tick 4 — D
- [x] live-run-ticks-05 — Live run / Animated 05 — live poll tick 5 — D
- [x] live-run-ticks-06 — Live run / Animated 06 — live poll tick 6 — D
- [x] live-run-ticks-07 — Live run / Animated 07 — live poll tick 7 — D
- [x] live-run-ticks-08 — Live run / Animated 08 — live poll tick 8 — D
- [!] note-live-vs-result — Note / Live run vs Run result — board is design commentary; no such note in the app; not captured — D
- [x] not-found-run — Not found / Run — D

## 6. Run result and comparison — `specs/results/`

- [x] run-result — Run result — passed run — D P
- [x] run-result-failed — Run result / Failed — D
- [x] run-result-failed-run-again — Run result / Failed / Run again — Run again clicked, start pending ("Starting…") — D
- [x] run-result-cancelled — Run result / Cancelled — D
- [x] run-result-out-of-memory — Run result / Out of memory — D
- [x] run-result-output-full — Run result / Output full — D
- [x] run-result-incomplete — Run result / Incomplete results — D
- [x] run-result-restored-history — Run result / Restored history — D
- [x] run-result-target-by-phase — Run result / Target by phase — D
- [x] run-result-what-happened — Run result / What happened — D
- [x] run-result-diagnostics — Run result / Diagnostics — D
- [x] run-result-diagnostics-log — Run result / Diagnostics — sanitized log opened — D
- [x] run-result-artifacts — Run result / Artifacts — D
- [x] run-result-artifact-viewer — Run result / Artifact viewer + Overlay / Artifact viewer — D
- [x] run-result-notes — Run result / Notes — note editing — D
- [x] run-result-notes-saving — Run result / Notes — saving — D
- [x] run-result-notes-conflict — Run result / Notes — changed elsewhere — D
- [x] run-result-download-open — Run result / Download open — D
- [x] run-result-compare-picker — Run result / Compare picker — D
- [x] run-result-toast — Run result / Toast — after an action — D
- [x] run-result-pending — — — result not ready yet — D
- [x] compare — Compare — two runs — D P
- [x] compare-empty — Compare / Empty — D
- [x] compare-metric-not-recorded — — — a metric absent on one side — D
- [x] export-run-preparing — Overlay / Export run / Preparing — Export script… on a run result, job generating — D
- [!] note-result-vs-live — Note / Run result vs Live run — board is design commentary; not captured — D

## 7. Inputs and exports — `specs/inputs/`

- [x] inputs — Inputs — D P
- [x] inputs-empty — Inputs / Empty — D
- [!] inputs-detail — Inputs / Detail — no detail page; inline status panel, no columns — D
- [x] upload-input — Overlay / Upload input — D
- [x] upload-input-uploading — Overlay / Upload input / Uploading — D
- [x] upload-input-publishing — Overlay / Upload input / Publishing — D
- [x] upload-input-published — Overlay / Upload input / Published — D
- [x] upload-input-chosen — — — file chosen, ready to send — D
- [!] upload-input-checking — Overlay / Upload input / Checking — fingerprint check is now visible within the form — D
- [x] upload-input-failed — Overlay / Upload input / Failed — D
- [x] upload-input-too-large — Overlay / Upload input / Too large — D
- [!] upload-input-interrupted — Overlay / Upload input / Interrupted — shows confirmed bytes; Resume appears after status refresh — D
- [x] phone-upload-input — Phone / Upload input — P
- [x] delete-input-in-use — Overlay / Delete input / In use — D
- [x] exports — Exports — job list, mixed states — D P
- [x] exports-empty — — — D

## 8. Settings — `specs/settings.visual.ts`, `specs/settings-states.visual.ts`

- [x] settings — Settings — `/settings` — D P
- [x] settings-loading — Settings / Loading — D
- [x] settings-installation — Settings / Installation — D
- [x] settings-installation-capacity — Settings / Installation / Capacity — D
- [x] settings-organization — — — `/organizations/:id/settings` — D
- [x] settings-organization-manage — Settings / Organization / Manage — newer board — D
- [x] settings-workspace — Settings / Workspace — D
- [x] settings-workspace-retention-preview — Settings / Workspace / Retention preview — D
- [x] settings-workspace-retention-progress — Settings / Workspace / Retention progress — D
- [x] settings-field-states — Settings / Field states — invalid/override/inherited fields — D
- [x] settings-field-states-couldnt-save — Settings / Field states — save refused — D
- [x] settings-field-states-saved — Settings / Field states — saved — D
- [x] settings-changed-elsewhere — Settings / Changed elsewhere — save conflict — D
