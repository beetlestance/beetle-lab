# Attempt resource observations

Status: locally verified at `2091573`. Contract:
[attempt resources](../design/lld/attempt-resources.md).

Installed supervisors now require an owned Docker stats reader. Existing ticks
start at most one sample per actor with two shared original slots and no queue.
Samples have a one-second deadline; summaries coalesce on a five-second cadence
and at exit. CPU is the latest cumulative container counter, memory/PIDs are
sampled maxima. Output usage stays unknown. Missing values, missed observations,
restart/reset provenance and raw memory semantics remain explicit in durable
events and the existing activity UI. These facts cannot change a Run verdict.

Stats and periodic publication originals do not hold the cancel/kill lane.
Lifecycle/resource publication shares one source-ordinal owner; uncertain appends
retain exact immutable intent. Exit and source collection wait for sample and
Journal originals before final event closure. Retirement/shutdown fence and drain
those same owners; cancellation never means an ignored original has settled.

## Evidence

The implementer independently reviewed the coordinator's contract. Coordinator
reviewed all15 implementation/fixture/oracle paths. The worker session failed
with a model compatibility error before finishing a raw CPU counter correction.
Coordinator completed that small correction and its regressions: a nanosecond
counter decrease is detected even if both values round to the same millisecond.
No additional independent code review is claimed for the coordinator correction.

Worker evidence includes60 scoped tests in8.25s; later publication fixes have
23 affected checks in4.135s. These overlap. An earlier affected run had375 passes
and one retirement error-order failure; ordering was restored and the focused
case passed. A forbidden agent-test-to-UI import was removed; gates were preserved.
Types, changed lint, architecture and docs passed in the retained local evidence.

Coordinator backend/monitor22 checks passed in1.12s, selected actual Docker-adapter/
Journal composition1 check in1.32s, and Node types passed in8.25s. Changed lint
initially caught complexity11; CPU counter observation was separated by responsibility
and lint passed. Three actual emitted Journal JSON artifacts were schema-validated
and passed through the real activity projector, including reset and missing labels.
Integrated architecture checked1655 source files; docs checked266 before this report.

Actual Journal/Manager fixtures cover applied-but-held publication replies, exact
replay, coalescing, kill during held sampling/publication, and source closure with
no later events. The transport fixture uses the real bounded Unix transport adapter
with synthetic ClientRequest/PassThrough objects; it does not open a Docker socket.
Commands, failures, raw logs, frozen hashes and recovery notes remain in local
task evidence. No full suite, build or new image qualification was run.

## Remaining qualification

Real daemon/cgroup measurements, native amd64/arm64, sensor variants and loaded
sampling overhead remain unqualified. No browser rendering, real-engine resource
accuracy, complete restart matrix, CI or release claim follows from these fixtures.
