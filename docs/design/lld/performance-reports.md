# Engine-owned performance reports

Status: reviewed local component/composition; F14 text/metrics-CSV presentation.
Owner: engines/k6/report; admitted wrapper collect phase owns file custody.
Existing numeric-final JSON remains the full numeric artifact; reports are derived
presentation, not a new outcome or metrics interpreter. Browser integration uses
published artifact routes, not a separate renderer with different arithmetic.

## Input and meaning

renderPerformanceReports consumes a mapped, unsealed K6ResultBody and the admitted
MetricSnapshot or null. Schema-check the result through a private witness seal;
that witness is never published. Copy/capture numeric series through shared metric
codecs and project values through the existing histogram percentile owner. At
most4600 unique observed series; reject duplicate identity and invalid evidence.
No configuration, target URL, request body, headers, dataset or secrets enter the
report input. Request/assertion labels remain the bounded numeric aliases.

Text records authoritative outcome, execution status, ordinary/discovery mode,
assertion-definition counts, threshold verdicts and discovery stop-rule evidence.
Result completeness and metric-window coverage are distinct. Preserve late-point
and marker-delay loss counts; totals can remain exact with incomplete windows.
Missing metric series/statistics are unknown, never zero. Observed series retain
execute versus engine scope; readiness/control and target sensors remain separate.
No rate recomputation from elapsed wall time, percentile averaging or outcome
inference. Duration estimates include method and lower/upper bounds.

CSV uses one stable wide header, one summary row even when no metrics exist, and
one row per observed series. Every row binds attempt/generation/outcome/completeness
and coverage. Blank statistic cells mean unavailable or inapplicable, not zero.
Quoted text escapes quotes and neutralizes leading spreadsheet formula characters;
numeric cells remain numeric. Output includes a final LF.

## Budget and custody

Each output is capped at256KiB including UTF-8 separators/newlines. Generation has
bounded input counts and bounded byte writers. Overflow rejects the whole report
with output_limit; invalid input has a fixed safe code. No truncation or partial
success. The two outputs and their bounded projection buffers are transient work,
not permission to retain unlimited memory or disk.

The existing output partition carves512KiB for both reports from the accepted
attempt total, reducing available build/history space. The collect-phase partition
reserves the same ceiling in addition to summary, numeric and final-drain space.
No configured total/phase budget is automatically increased. An insufficient
partition rejects before native load. Actual report bytes count once in collect.

Artifacts.report writes only performance-report.txt and metrics.csv, using the
existing exclusive/no-follow mode0600 files, exact hashes, repeated file identity
checks, fsync and original descriptor-close custody. Cancellation fences each
operation. Partial/unknown files stay retained and charged; no speculative unlink
or sealed manifest references an unverified file. Report failure cannot rerun load.

The final engine result lists both artifacts with their byte lengths and hashes.
Backend adoption/download uses its existing verified artifact pipeline. The fixed
256KiB per-output ceiling can reject large reports even with a larger total budget;
this explicit first-release limit does not permit silently omitting series. RunResultRead selects exactly one scoped published performance-report descriptor;
multiple reports show an explicit ambiguity error. The browser verifies <=256KiB,
exact file length/SHA256 and fatal UTF-8 before rendering plain text. No report
HTML, second metric renderer or browser-side outcome inference is used. The shared
artifact reader owns two originals across target/performance kinds and a5s whole
read. A session/scope/attempt/artifact display lease and independent5s UI watchdog
retire stale results without releasing unsettled originals. Retry is explicit.
Safe fixed-UUID text/CSV/JSON attachment links reuse the existing artifact routes.
Actual browser display/save qualification remains pending.
