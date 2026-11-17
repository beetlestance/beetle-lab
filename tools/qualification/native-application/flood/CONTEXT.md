# Native metric pressure, slow download and cancellation

Use the task-owned long ARM fixture 2/final-read fixture 1 corpus. Verify archive,
configuration, image, recipe, project, root and installation bindings before any
effect. Require no running containers and retain cold database/WAL baseline copies.
Do not install, migrate, rewind databases, increase pools or touch user services.
Use a separate synthetic HTTP target; preserve the existing Compose environment.

The workload uses four VUs, up to 1000 iterations, a 30 s maximum, four requests
with 48 assertions each, 20 ms waits and a 198-label budget. Target requests are
bounded to 8000 work calls and two readiness calls; successful responses emit
assertion metrics.

- Overflow profile: 4 MiB output, physical running/work latch, exact wrapper
  `output_limit` evidence through live attach, errored/inconclusive outcome and
  closed runtime. Keep public `artifact_incomplete` attribution explicit.
- Cancellation profile: 16 MiB output and a stalled 7.9 MiB old-artifact response.
  Require capacity refusal (503), cancellation acknowledgement and actual runtime
  stop while the reader is held. Require the actual cancelled event cause.
- Join original reader, attach and RSS operations; verify old-artifact digests.
- Preserve one CPU, 512 MiB and 128 PIDs. Requested timeout is 60 s. The donor long
  policy differs only in timeout. Bound RSS observation to 120 s/128 points and
  the outer check to 300 s; bound API calls, bodies, logs and socket lifetimes.
- Require normal and independent cleanup; keep raw reports private.

Selected cancellation and overflow profiles passed; the default combined profile
was not rerun. Baseline `733b49cc` includes attribution fix `ce13ee8b`; images were
verified at `b489`. Preserve earlier reset-fixture, duplicate-name and guard-artifact
failures; the scanner's exact cause remains unknown. This evidence does not prove
a memory plateau, telemetry-off behavior, all-platform behavior or general overload
availability. Never rerun the old producer merely to replace a failed record.
