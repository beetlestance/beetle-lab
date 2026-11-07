# Native metric projection

Public `MetricStream` accepts trusted allowed metric names/kinds and the compiled
rN/aN label sets; it never learns a series from native output. Metric declarations
precede points, each declaration is unique. Only finite nonnegative numeric points,
UTC/offset timestamps and approved singleton request/assertion tags leave the parser.
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
Numeric aggregation, histogram/window output and wiring remain separate work.
Source format: https://grafana.com/docs/k6/latest/results-output/real-time/json/
Pinned native encoder: https://raw.githubusercontent.com/grafana/k6/v2.2.0/internal/output/json/json.go
Check: npx vitest run engines/k6/test/aggregation --maxWorkers=2.
