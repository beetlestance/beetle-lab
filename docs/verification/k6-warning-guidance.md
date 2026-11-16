# Native warning evidence and configured VU guidance

Status: locally implemented and independently reviewed. Contract:
[warning guidance](../design/lld/k6-warning-guidance.md).
This closes the selected F10 implementation slice, with packaged/platform acceptance
still open. Retained diagnostic text/viewing/replay belongs to F07/F11 separately.

## Behavior

The engine classifies bounded JSON stderr records into insufficient VUs, high
cardinality, maximum duration and other warnings. It retains no raw diagnostic
text in the artifact. Malformed, unknown, oversized or interrupted records make
coverage partial; zero counts under partial coverage cannot prove absence.
Counters count observed log records, not unique incidents or dropped iterations.
Existing native byte limits, outcome mapping and original drain ownership apply.

A separately sealed, scoped k6-warnings JSON artifact is at most4096 bytes including
its newline. Reservation happens before execution:4096 bytes come from the existing
numeric1MiB, with unchanged total/build/history ceilings and minimum refusal.
The existing result/descriptor/control allocations remain unchanged. Publication
requires spawned, actually closed native evidence. Older receipts remain absent.

The browser uses the existing capped, hash/length/deadline-verified artifact reader
and shared original-call credits, then checks payload organisation/workspace/attempt.
Ambiguous artifacts fail closed. Configured arrival guidance uses the compiler's
canonical duration policy over already-compiled options; no emitted load is changed.
Automatic guidance requires one arrival scenario and a unique complete global
execute iteration-duration distribution. Other/mixed scenarios, ambiguous series,
request latency and partial collection cannot substitute. Ramp/discovery peak
assumptions, histogram bounds, sample count, headroom, configured VU cap and
completed-iteration bias are explicit. Estimates never change configuration or
claim safe machine capacity. Existing manual observed-drop advice remains.

## Verification

Frozen local lane:12 successful checks, including185 cases in12 focused files,
Node/browser/runtime types, lint, architecture, docs, contract/API/compiler drift
and engine/agent/API/frontend builds. Existing affected native/attempt tests also
ran during development:122 passed initially; two expectations needed the new fixed
argv and warning partition. Failure logs remain with the private task evidence.
Additional artifact-reader lifetime checks passed with the shared unchanged owner.

One actual native qualification used current built payloads in local Linux arm64
agent/engine overlays, with a macOS host backend. All286 engine payload files and
three agent bundles were hash-verified before use. The pinned k6 emitted one
insufficient-VU record under a two-second20iterations/s, one-VU synthetic workload.
The586-byte sealed artifact reported complete diagnostic coverage, the configured
rate/cap, and a complete iteration median of about502ms from four iterations.
Actual public API reads checked scope, length and SHA256. Metadata reopen preserved
the exact result and downloaded artifact. Closed-source/accounting checks passed.
Target counters were one readiness, four work and zero unexpected requests.
The qualification finished in10.326s; owned containers/networks were removed.
One optional container diagnostic-log capture was unavailable and remains recorded
in private evidence; artifact verification did not depend on that log capture.

Private source hashes, image identities, failed/final check logs, task packets and
native evidence remain under the coordinator's .agent-work/k6-warning-guidance.
No raw credentials, installation paths or operational data are committed here.

## Limits

Native positive classification here covers insufficient VUs; other categories and
loss behavior have synthetic classifier tests, not a full native message matrix.
This is final warning evidence rather than live diagnostic streaming. No raw log
retention, new backend endpoint/index/job, storage grant or automatic capacity
change was added. No browser, Compose, Linux-backend or native amd64 release claim.
Images were built locally for qualification; no registry publication, user-service
restart or deployment occurred. Full UI redesign remains a later separate task.
