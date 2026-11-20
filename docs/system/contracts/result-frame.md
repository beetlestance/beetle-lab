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
diagnostics and artifact tabs retain their usual publication checks. Diagnostics
shows a clean-exit summary only with a recorded exit code of zero and a complete
verified warning capture with no warnings or discarded segments.

An incomplete result can display whole-run figures from the verified native k6
summary. They carry native provenance, with endpoints absent when no verified archive exists. Charts may use
recovered observations when available. Threshold readings remain visible without a
run-level pass or fail label.
For a stopped run, accepted partial threshold measurements use Not judged.
Missing figures stay unavailable and the recorded test duration is shown only
when provided by the accepted source. Positive durations below one second
are shown in milliseconds. Positive sub-millisecond latency estimates stay
distinct from zero in Results and endpoint measurements.

A restored Results view links back to the live installation when the history
viewer has a configured live origin. The link suppresses the viewer referrer.

## Recovered observations

For a cancelled or errored run without a published chart archive, Results calls
`getRunStoppedHistory`. One metadata transaction checks the workspace, current
attempt, deletion status and final source or absence receipt. It returns at most 2 MiB of
verified checkpoint observations. The same read works in a restored viewer.
Missing evidence returns `not_found`. Other read failures offer a retry.
A confirmed absent engine result does not offer another result check when
the stopped-history read has already resolved.

The charts label the time origin and coverage. They display retained metric
windows and target readings, with gaps and unavailable values preserved.
Published target reports take precedence over the recovered target samples. The
overview switches between p95 latency and request rate for the same windows.
They carry no whole-run totals, threshold verdict, endpoint summary or archive.
When a stopped attempt has neither an archive nor retained observations, Results
explains the missing measurements directly. Pending reads and errors retain
their retry controls.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/runs/result/headline.ts` | `8e01d1114a29` |
| `web/src/features/runs/result/SectionNav.tsx` | `df2ddd83ae5c` |
| `web/src/features/runs/result/ResultHeader.tsx` | `5c499047e48e` |
| `web/src/features/runs/result/RunNote.tsx` | `0f0c005de309` |
| `web/src/features/runs/result/PhoneDisclosure.tsx` | `476db0bf7a25` |
| `web/src/features/runs/result/phone.css` | `bc210295ad3f` |
| `web/src/features/runs/result/ReportTabs.tsx` | `bd57a4bf1356` |
| `web/src/features/runs/result/EndpointTable.tsx` | `992cc7cfab59` |
| `web/src/features/runs/result/overview.css` | `5d868a563f67` |
| `web/src/features/runs/result/PhoneSummary.tsx` | `68d10e26b948` |
| `web/src/features/runs/result/RecordedCharts.tsx` | `5b673f28a315` |
| `web/src/features/runs/result/charts.css` | `16f39f9e223b` |
| `web/src/features/runs/result/index.tsx` | `1270c4efb1e3` |
| `web/src/features/runs/result/ResultReadProblem.tsx` | `acab58611569` |
