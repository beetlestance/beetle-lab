# Recorded result milestones

What happened reuses the same bounded event projection and timeline owner.
The expanded activity details show admission, phases, runtime start/exit, sealed artifacts,
provisional engine report, cancellation and lost observation in source sequence. Heartbeats, per-case
rows and resource reports stay in the existing technical details. No second event
read, raw event cache, inferred start/finish or verdict is introduced.

The list shows source clock times, with complete timestamps in title/dateTime.
Clock rollback stays visible and never causes reordering. These are observations,
not elapsed times. Pending capture, partial coverage, retained gaps, omissions,
blocked delivery and explicit retry preserve the existing owner semantics.
A retained heartbeat-only tail says no milestones are present; it never implies
that milestones never occurred. At most 100 projected rows / 64 KiB remain cached.

## Stage schedule

An available single-scenario saved plan contributes its scheduled stage labels and
offsets, including drain. When a verified scenario origin is available, stage offsets and matching
native observations share one scenario-relative list. Lifecycle events stay in
source sequence under the activity disclosure. A scheduled offset never establishes that a transition occurred or
that an interrupted run reached that stage. Other plans omit the schedule.
One positive HTTP window from the existing chart read may be attached to a
stage. It must fit wholly inside that stage relative to the native scenario
origin, and both reads must match scope, attempt, numeric artifact and manifest.
Windows crossing a stage boundary, drain, missing evidence and unavailable chart
sources add no observation. A window attests HTTP samples, not stage entry.

## Recorded scenario origin

A single managed k6 scenario records its native start timestamp on iteration zero.
Each VU reads the iteration index on its first iteration only.
The private gauge emits at most one untagged point and stays outside queryable
metric series, windows and thresholds. The collector withholds duplicate or
inconsistent timing and keeps independent measurements. A valid timestamp is
bounded by the setup marker and its observation. The existing sealed numeric
artifact optionally carries it on v4 and v5 when it fits the existing byte allowance. The backend verifies the artifact
and attempt binding before returning it in the metric overview. Older archives, standalone scripts and
overlapping scenarios carry no origin. This records scenario start only. Later
stage boundaries still need runtime evidence. The Results panel shows the actual native origin.

## Native latency observation

The selected desktop activity panel (or opened phone disclosure) reads the existing
terminal latency-attribution endpoint once; no polling or per-endpoint fanout.
Its detected rise uses native source instants. Elapsed display requires a version 4 or later
measurement origin from the already-read metric overview, matching generation and
manifest. When a valid scenario origin precedes the rise, the display uses that
clock; otherwise the matching setup marker remains the elapsed origin.
Negative/unsafe differences, absent or legacy origins and mismatched sources show
the reported source timestamp instead. Event source clocks remain separate from the scenario timing list.

Endpoint labels come from the matched saved revision's bounded request aliases.
Missing revision metadata leaves the path out. Native absence, no detected rise and
read failure are explicit; a failed refresh hides cached rise figures. Retry is
explicit and does not cancel/replace an issued read. Unfinished restored state does
not trigger terminal analysis or remain falsely stuck loading.

The existing activity details retain container resources and every retained event.
Native latency rise is an observation heuristic, not a causal or statistical claim.
These source checks do not qualify a packaged native deployment.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/runs/timeline/index.tsx` | `e6db7f650bd3` |
| `web/src/features/runs/timeline/StageSchedule.tsx` | `540920b44ccc` |
| `web/src/features/runs/timeline/Milestones.tsx` | `ba2b2f78e6f1` |
| `web/src/features/runs/live/Extras.tsx` | `9e304d336e54` |
| `web/src/features/runs/live/rise-position.ts` | `f258dd76cd10` |
| `web/src/features/runs/result/ReportTabs.tsx` | `835b8f06014a` |
