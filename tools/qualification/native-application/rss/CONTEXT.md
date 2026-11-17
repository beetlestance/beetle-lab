# Owned control-process RSS qualification

Measure Linux ps RSS through bounded asynchronous Docker top commands, outside the
control containers. Only already-inspected fixture peer IDs are accepted. No Node
process is injected into the services. At most 128 observations/120 s, three peers,
10 s/64 KiB command bounds; every original command settles before cleanup.

Reuse the existing idle/40-iteration load/post-idle and three-reader fixture.
Discard observations crossing phase boundaries. Require at least two points per
peer/window, and summed RSS under that service's declared memory ceiling. Linux
RSS KiB is converted to bytes; the sum double-counts shared resident pages and is
not unique physical memory or cgroup usage. No process ID/command is published.

This is short RSS evidence, not a telemetry on/off comparison, retained-growth
proof or a 30-minute qualification. Preserve misses and private full reports.

public.ts revalidates point bounds/roles/times and recomputes the nine summaries;
CI projects them alongside the existing strict short-control outcome. rss-amd64
selects only this missing native case; raw PID/command or private reports are never
uploaded. Source staging and independent cleanup gates remain unchanged.

Failure reports use the private4MiB no-follow reader (timings may exceed delivery
metadata's256KiB). Target-missed remains failed and retains bounded latency and
fixed source coordinates; no raw exception or point data is uploaded on failure.
