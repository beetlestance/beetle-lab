# Owned control-process RSS qualification

Measure Linux ps RSS through bounded asynchronous Docker top commands, outside the
control containers. Only already-inspected fixture peer IDs are accepted. No Node
process is injected into the services. At most128 observations/120s, three peers,
10s/64KiB command bounds; every original command settles before cleanup.

Reuse the existing idle/40-iteration load/post-idle and three-reader fixture.
Discard observations crossing phase boundaries. Require at least two points per
peer/window, and summed RSS under that service's declared memory ceiling. Linux
RSS KiB is converted to bytes; the sum double-counts shared resident pages and is
not unique physical memory or cgroup usage. No process ID/command is published.

This is short RSS evidence, not a telemetry on/off comparison, retained-growth
proof or a30-minute qualification. Preserve misses and private full reports.
