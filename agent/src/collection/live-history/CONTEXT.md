# Advisory active history

readLiveHistory reads fixed metric and optional target prefixes under one retained
native lifetime. Callers independently resolve the active attempt and approved
producer epoch; received metadata never establishes its own authority.
Snapshot capture binds nested scope/counts/names/extents. Target hints require the
approved sampler interval before this reader is called.

One shared native range credit excludes overlapping cleanup. Up to four read-only
no-follow descriptors retain root/file identity and exact UID/mode: root, metric
pair and optional target file. Appending is allowed; replacement, truncation below
captured extents or changed captured bytes fails. All hashes and records, actual
closes and final named checks precede success. A failed close retains admission.
Root timestamps may change as the active producer creates other files; identity may not.

Metric pair <= 256 MiB / 65536 windows; target <= 1 MiB / 256 samples.
IO <= 64 KiB; data record <= 1 MiB; target record <= 16 KiB; header <= 1 KiB;
index row <= 256 B. Line buffers are bounded per lane; partial reads allow
4 * ceil(prefixBytes / 64 KiB) + 1024 calls per file. One 30 s deadline covers all.
Target header binds scope, UUID and interval, then contiguous sample rows/count
and SHA verify the exact extent. The shared target schema keeps full values,
units, phases and unknowns. No thinning, interpolation or timestamp rebasing.

targetSamples is present iff a target prefix exists, with its exact retained count.
All target bytes/nodes are reserved before metric selection. Response stays within
2 MiB / 65536 JSON nodes. Metric pressure removes actual interior windows while
preserving first/final and marking sampled; <= 900 windows, never averaged p95.
Public access still requires the existing scoped backend and protected HTTP route.
Contract: docs/system/contracts/active-history.md.
Focused checks: agent/test/live-history and agent/test/supervisor/live-history.test.ts.
