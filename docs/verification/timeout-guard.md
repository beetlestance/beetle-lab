# Timeout watchdog evidence

Date: 2026-11-09. Integrated source: `0fa3898` (initial candidate `ca2336d`).
Environment: Node26.7.0/macOS arm64, real temporary SQLite and staging fixtures;
Docker effects and clocks remain controlled.

## Implemented path

A separate watchdog polls admitted attempts without waiting for staging, output
scans, scheduling or original runtime operations. It compares both the absolute
admission deadline and a nonextending local monotonic ceiling. Installation captures
monotonic time before its original durable supervision read, then attaches the watch
before staging. Waiting for old metadata consumes the original execution budget.

Clock rollback, invalid samples and durable clock fences request clock_integrity;
ordinary elapsed budgets request timeout. One bounded clock-integrity escalation
may overtake a held timeout request without abandoning either original. Installation
persists typed intent, aborts preparation and signals the owned controller. Existing
supervisor launch checks, grace policy and release authority remain in place.

The service bounds retained watches to64, owns one interval and has no waiting
queue. Close is cached, fences new requests and drains originals independently.
Rejected stops retain failed ownership and refuse clean shutdown. Watch readiness
and acknowledged intent do not certify runtime exit, result validity or release.

## Independent review

Review verified the frozen candidate and29 read hashes. A fault probe held the
actual Installation supervision response, advanced only local monotonic time beyond
the budget, then returned the old durable response. The attempt timed out without
preparation, creation or start; the old response did not renew its deadline.

Review reproduced a shutdown race suggested during coordinator inspection: a clock
callback closed the service and then threw, allowing a new stop request after close.
The correction fences both clock-failure iteration and duplicate-registration
fallback after reentrant close. Status and duplicate-registration regressions pass.
The reviewer independently reran the original reproduction against the correction.

The corrected review verified31 frozen reads and exactly two changed paths;
23 tests passed, including its independent regression, and scoped lint passed.
Coordinator comparison matched27 final source/spec/test hashes to integration.
No blocking finding remained within this component and attachment scope.

## Executed checks and limits

`npm run verify:v2` exited0 on `0fa3898`: **2434 tests/211 files**, all three
TypeScript projects, lint, generation37/23/6, architecture702, docs112 and frontend
build. Tests took123.05s. The existing611.56kB/178.59kB gzip chunk warning remains.
The focused watchdog/installation/HTTP run passed59 tests before the two additional
shutdown regressions; the final focused watchdog/attachment run passed22 tests.

Fixtures cover original admission expiry, metadata wait, forward jumps, rollback,
invalid clocks, future/fenced anchors, held/rejected stops, one emergency escalation,
registration bounds/conflicts, fixed-field input capture, reentrant shutdown and
restart without staging or another execution. Real staged preparation remains
charged while its quiescence original is held, then aborts without late launch.

No native Docker deadline/stop-latency, full-pool workload, overshoot or hard timeout
guarantee is established. Held runtime/journal operations and saturated intake can
delay signalling. The combined fresh-guard publisher, agent startup, packaging,
irreversible recovery fencing and complete application run path remain separate work.
No hosted CI run, publication, deployment or protection change is claimed.
