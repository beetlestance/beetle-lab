# Recorded result milestones

What happened reuses the same bounded event projection and timeline owner.
Admission, phases, runtime start/exit, sealed artifacts, provisional engine report,
cancellation and lost observation appear in source sequence. Heartbeats, per-case
rows and resource reports stay in the existing technical details. No second event
read, raw event cache, inferred start/finish or verdict is introduced.

The list shows source clock times, with complete timestamps in title/dateTime.
Clock rollback stays visible and never causes reordering. These are observations,
not elapsed times. Pending capture, partial coverage, retained gaps, omissions,
blocked delivery and explicit retry preserve the existing owner semantics.
A retained heartbeat-only tail says no milestones are present; it never implies
that milestones never occurred. At most 100 projected rows / 64 KiB remain cached.

## Native latency observation

The selected desktop activity panel (or opened phone disclosure) reads the existing
terminal latency-attribution endpoint once; no polling or per-endpoint fanout.
Its detected rise uses native source instants. Elapsed display requires a version 4 or later
measurement origin from the already-read metric overview, matching generation and
manifest. Negative/unsafe differences, absent or legacy origins and mismatched
sources show the reported source timestamp instead. Event clocks and native offsets
are never combined or sorted into a shared invented chronology.

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
| `web/src/features/runs/timeline/index.tsx` | `23f6cfccb7f9` |
| `web/src/features/runs/timeline/Milestones.tsx` | `ba2b2f78e6f1` |
| `web/src/features/runs/live/Extras.tsx` | `ad293364de0f` |
| `web/src/features/runs/live/rise-position.ts` | `136a516589c3` |
| `web/src/features/runs/result/ReportTabs.tsx` | `bd57a4bf1356` |
