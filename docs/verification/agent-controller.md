# Agent controller and output evidence

Date: 2026-11-08. Combined source: `ba5dc4a`.
Controller reviewed at `540fa4c` (lifecycle) and `ad90268` (collection/tails).
Output collector reviewed at `b0038b8`, integrated as `c1adc2a`.
Environment: Node26.7.0/macOS arm64, actual temporary files and SQLite.

## Integrated behavior

A prepared-attempt controller connects the existing supervisor, incremental
control reader, atomic journal checkpoint, generic output collector and capacity
release transaction. The installation must first admit the job, finish staging
and await original staging quiescence. No second create/start authority is added.

Final output verification uses the shared result seal codec, scoped generation,
installed engine identity and immutable journaled result. It streams every declared
artifact through64KiB windows with hash/length/canonical path/owner/mode/single-link
checks. Two processwide operations retain their slots through original cleanup and
post-close named-path verification. Declared bytes, result and control bytes must
fit the admitted output budget; undeclared occupancy/hard quota is a separate guard.

Controller tests exercise real staging, filesystem control intake, SQLite commit,
sealed result verification and release together. Docker execution remains controlled
in those tests; no k6 request or Linux container is executed by this fixture.
Collector tests separately exercise real result/artifact files, aliases/FIFOs,
mutation, exact byte limits and original-work failures.

## Review corrections and checks

Independent review reproduced and corrected rejected-quiescence cleanup allowing
release, an empty stopped stream retaining capacity indefinitely, and collection
receiving extra time after its admitted deadline. A further real one-byte-read
probe distinguished valid fragmented first frames from empty files. Both now have
real filesystem regressions. Unknown launches and original cleanup failures remain
charged; busy collectors defer within a nonextending deadline without rerunning load.
Ambiguous control commits preserve their batch while fencing further execution.

A separate collector review reproduced artifact mutation during delayed root close.
The correction rechecks retained named-path identities after all original descriptor
closes, then applies the final deadline/cancel fence. Independent mutated and
untouched probes both passed their expected rejection/success with exactly-once closes.

Focused controller checks passed24tests/threefiles; collector checks passed63/five.
At clean `ba5dc4a`, `npm run verify:v2` exited0: 2,203 tests/185 files, all three
TypeScript projects, lint, generation37/23/6, architecture621 and docs92. The
frontend build passed with its existing611.56kB/178.59kB gzip chunk warning.
Evidence documentation was then checked separately; runtime source was unchanged.

## Remaining qualification

This is prepared-attempt/component evidence. Installation scheduling, fresh
admission/staging composition, actual resource observations/output guard, private
agent HTTP, full agent/container restart/shutdown and application finalization
remain. Release is not a test pass, artifact-transfer acknowledgement or deletion
authority. No new image build/publication, Linux/Node24 controller run, amd64,
backup/soak/security-scan qualification or complete application journey is claimed.
