# Run views

RunDetail (runs/RunDetail.tsx) owns the run query, cancellation and header, then
picks a phase once per mount: nonterminal → `live/LiveRunView` (Wave 1 package D),
terminal → `result/RunResultView` (package E). A run that ends while watched stays
in the live view, which keeps its last figures and offers "Open result"
(`showResult`); switching remounts the view and re-reads the result.
`terminal()` lives in `runs/terminal.ts`.

The live view (Penpot "Live run" boards) no longer wraps RunSnapshot. Phases come
from `copy.phaseOf`: waiting (getRunQueue), starting (timeline row kinds),
running, cancelling, finalizing (timeline rows), ended. `plan.ts` reads stages,
requests (rN = index in `config.requests`) and thresholds from the saved
revision; `model.ts` derives window figures from one live frame. There is no
pooled latency series, so percentiles show the slowest endpoint and are never
averaged; rules read "unknown" when the pooled value cannot be bounded. Configured
limits use known metric/stat dimensions; unknown dimensions are labelled explicitly.
Elapsed time stays unavailable for missing, browser-unparseable or future starts;
source timestamps remain visible rather than becoming NaN or fabricated zero.
`stream.ts` (`useLiveStream`) owns feed status, pause, retry and the latest frame;
`history.ts` keeps at most 900 frames this browser received. Chart captions always
state this coverage; a known run origin is not evidence of earlier windows. Target runtime charts use
`LiveMetricSnapshot.target` values as reported (units are not documented).
Direct entries resolve organisation/workspace names once through shared scoped
query keys. Metadata errors hide stale names and offer retry while metrics continue.
Optional `cancel` takes RunDetail's cancellation owner; there is no second owner.
The p95-rise line reads getRunLatencyAttribution only once terminal. The
restored-backup banner and Cancel use useSessionAccess (app/session.tsx); no session read.
No report or metrics downloads while live. Header icon actions use a native
Download disclosure (Escape/outside press dismiss); the script row opens verified
revision selection, never prepares an export automatically. Selection reads at most
20 summaries plus the run’s verified revision; older history links to the suite.
Cache and fresh revision reads bind scope, suite, ID and digest before use;
metadata failure offers retry without stopping metrics. Script format is
JavaScript, not the older board's ZIP copy. Header/progress styles have separate
owners, keeping modules below 400 lines. Tests: model.test.ts, ui.test.tsx.
