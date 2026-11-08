# Native k6 compatibility check

Run explicitly with an installed k6 v2.2.0 binary:

```sh
node --import tsx engines/k6/test/native-process/smoke-phase.ts /absolute/path/to/k6
```

The check owns an ephemeral loopback HTTP server and private temporary directory.
It builds the production runtime, sends one slow readiness request and one workload
request with one VU/iteration, then streams native NDJSON through the production
decoder/accumulator and reads the summary through the strict post-stop collector.
It uses a ten-second native deadline, bounded transport and a fifteen-second
cancellation timer; the process owner retains its normal termination/drain behavior.
No external target or credentials are used. The synthetic files remain at the
printed temporary directory for inspection.

Assertions cover preparation exclusion, one untagged marker, complete window
coverage, exact measured request counts, native Trend summary count, zero required
failures, source quiescence and the native whole-engine counter-rate denominator.
The version is checked before execution. A native nonzero exit is never converted
to a successful test outcome.

On macOS this deliberately uses the private process test seam. The public product
entrypoint still requires Linux; this check adds no host-process installation mode.
It does not establish Docker isolation, memory containment, restart/replay,
application finalization, either container architecture or release readiness.

The initial phase-isolation candidate exited 104 before issuing requests because
it generated unsupported `count` thresholds for native Trends. Independent review
identified that error. Corrected observers use `avg>=0`; the actual native path
then passed. See [phase semantics](../decisions/010-readiness-metric-isolation.md)
and [local evidence](local-foundation.md).

Executed at committed source `f92c551` on Node26.7.0/macOS arm64: exit 0, k6
v2.2.0, one readiness plus one workload request, 48 records/9,036 bytes, complete
windows, no diagnostics, native duration 109.802 ms and measured HTTP count one.
The strict collector accepted the result and observed the owned child group absent.

Builder `2d8cec4` adds caller-reserved scratch-byte accounting and direct pinned
esbuild output admission before file writes. At source `f28f249`, the same native
check passed again: 48 records/9,037 bytes, native duration 115.935 ms, one measured
HTTP request and complete windows. Nineteen focused build tests and independent
UTF-8 quota/symlink-preservation probes passed; this is a logical file-byte limit.
