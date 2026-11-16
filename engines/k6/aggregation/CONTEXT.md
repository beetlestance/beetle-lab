# Native metric projection

Public `MetricStream` accepts trusted allowed metric names/kinds and the compiled
rN/aN label sets; it never learns a series from native output. Metric declarations
precede points, each declaration is unique. Only finite nonnegative points, timestamps and approved phase/request/assertion tags leave the parser.
Raw metadata, URLs, groups, errors and arbitrary tags are never forwarded or logged.
Input is stock k6 NDJSON, one LF-terminated record per line; CRLF is JSON whitespace.
Each push snapshots <=1MiB, retains <=64KiB partial frame, and serially awaits one
required projected-point sink. Total byte/record work is explicitly capped. A busy
push is refused without poisoning the current one. Parse/sink/abort failure poisons
future eligibility; close fences late success and awaits the original issued sink.
The caller owns operation deadlines; sinks receive AbortSignal and must honor it.
A stuck sink keeps close pending; this parser does not claim remote termination.
`finish` requires no outstanding work and no torn tail. It proves parser framing,
not native completion, artifact durability, test pass/fail or reservation release.
`createK6MetricProfile` snapshots public plan definitions/layout and labelled IDs;
its shared per-metric catalogue rejects impossible combinations (<=4600), retaining
the original 200 assigned-label budget. Production profiles require this catalogue.
`MetricAccumulator({profile, window})` accepts decoder points through async `point`,
async `finish(signal)` and idempotent `close()`. Its required window sink is awaited.
It retains exact observed numeric totals and <=3 occupied source-second buckets;
source high water allows 2 seconds lateness, never allocates gaps or stores history.
Validated preparation points are discarded before totals/highwater/window work.
Delayed markers retain execute totals and <=3 pending buckets without publishing;
aged-out buckets mark separate markerDelayDroppedBuckets coverage gaps. Execute
source times preceding the marker fail measurement. Pre-marker engine gauges
enter engine totals only; actual post-marker samples alone enter windows.
Late points still update totals but mark window coverage partial. Gauges choose
latest by source timestamp; unobserved series stay absent, measured zero stays zero.
Exactly one untagged counter marker of value 1 is required; missing/malformed/
duplicate evidence fails with `measurement`. Source time is correlation only.
Series totals/windows retain execute or engine scope. Snapshots are deeply frozen. Counts/counter sums must be safe integers, sums finite; overflow fails. One issued operation, busy rejection without poison,
close/abort fence late callbacks and preserve outstanding sink work. No native termination or outcome inference is claimed here.
Shared @beetle/contracts/metrics owns immutable exponential-v1 ms distributions, <=64 buckets,
scale4 down to -10. DurationHistogram records in place; mergeDistributions validates
external snapshots before bounded work. distributionPercentile returns conservative
nearest-rank histogram-estimate intervals, never native threshold verdicts.
External standalone distributions require <=2KiB JSON admission before parsing;
in-process validation expects bounded data objects, not hostile reflective proxies.
Check: npx vitest run engines/k6/test/aggregation --maxWorkers=2.
