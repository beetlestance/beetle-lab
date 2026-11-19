# Result frame and traffic headline

Status and severity titles use authoritative Run state. Passed phone titles lead
with the recorded average when rate and duration are known. Traffic wording uses
one ready metric overview when available, including null values; it never fills
missing overview fields with values from the history index. Without a ready
overview the existing indexed summary remains the fallback. Native SLO verdicts
and saved limits retain their own bindings. No new read is introduced.

Whole-run RPS is labelled as an average over the measured duration, not a steady
rate maintained throughout every phase. Percentile estimates retain approximate
wording. Missing duration, rate, percentile or failure ratio remains unknown.

The frame separates title/actions from a full-width sentence. Section navigation
keeps real hash anchors, follows external/native hash changes, marks its selected
location and calls the existing lower report-tab selector when required. It adds
no reading or mutation ownership.

Desktop notes live below the title; phone notes join the lower disclosures.
A missing writable note offers Add a note; restored history offers no writes.
The run-note classes are distinct from the engine-result panel's diagnostic note
styles. Note edit stamps and explicit conflict choices follow
[authoring](authoring.md#run-notes), with frozen drafts and receipt-only replay.
Legacy timestamps remain unrecorded; restored views have no note controls.

Source browser checks do not prove packaged/native delivery or whole-family
visual acceptance. Phone disclosures now cover What happened, Target runtime,
Artifacts, Notes and Diagnostics. More run details holds Report, additional charts
and the saved script, and a direct hash opens both disclosure levels. Readers
mount readers on first open and retain visited children; the single Notes owner
survives collapse and resize, including unresolved identical-replay saves. Hashes
open the addressed section. Phase comparison keeps its target and Back control
visible. Phone endpoint columns put p95/failed first and keep them visible while other
columns scroll in a named keyboard region. Desktop order, filters and exact
source values survive resize. Phone endpoint names stay on one line with ellipsis
for long paths; the full name remains the row label. Nulls and zeros remain distinct.
Phone summary leads with average rate, p95 estimate, failure ratio and total
requests from one accepted source. Other measurements stay in expandable details;
partial-coverage warnings remain visible. Legacy/pending history keeps four explicit
unknown figures, never invented zeros. Desktop summary stays unchanged.
Phone titles use 34 px tokens and compare/download precede Run again and Pin.
Refresh and permitted deletion remain reachable under More actions. Phone context
uses a stored finish time when present. The compact whole-run chart shows three
time labels, preserves source points, gaps and bounds, and displays readings on hover. Sampling and
coverage details remain expandable, with partial-source coverage in the summary.
Advanced target details retain explicit Reload through the same bounded owner;
a failed reload hides previous charts. Whole-family and packaged proof remain open.

Result-detail failures offer an explicit read-only retry, separate from Refresh run.
Its pending control stays disabled; reads never retry automatically. Suite and
revision metadata share one original/four-waiter admission, separate from the same
bounded metrics lane so archive reads cannot hold up lightweight details.

An incomplete run whose chart and overview reads confirm a missing archive
shows one explanation in place of chart and endpoint sections. The report,
diagnostics and artifact tabs retain their usual publication checks.

An incomplete result can display whole-run figures from the verified native k6
summary. They carry native provenance, with the chart and endpoint section absent
when no verified archive exists. Threshold readings remain visible without a
run-level pass or fail label.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/runs/result/headline.ts` | `f5870937c29e` |
| `web/src/features/runs/result/SectionNav.tsx` | `c6e30d9a0588` |
| `web/src/features/runs/result/ResultHeader.tsx` | `5c499047e48e` |
| `web/src/features/runs/result/RunNote.tsx` | `0f0c005de309` |
| `web/src/features/runs/result/PhoneDisclosure.tsx` | `476db0bf7a25` |
| `web/src/features/runs/result/phone.css` | `bc210295ad3f` |
| `web/src/features/runs/result/ReportTabs.tsx` | `c3961288919e` |
| `web/src/features/runs/result/EndpointTable.tsx` | `20fd4c27e821` |
| `web/src/features/runs/result/overview.css` | `5d868a563f67` |
| `web/src/features/runs/result/PhoneSummary.tsx` | `3fe841d6d930` |
| `web/src/features/runs/result/RecordedCharts.tsx` | `d413bd4d2005` |
| `web/src/features/runs/result/charts.css` | `16f39f9e223b` |
| `web/src/features/runs/result/index.tsx` | `6278ae56eb3c` |
| `web/src/features/runs/result/ResultReadProblem.tsx` | `acab58611569` |
