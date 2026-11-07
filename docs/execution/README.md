# Multi-agent rewrite execution plan

Status: implementation started in an isolated integration worktree. This document
defines execution policy; the session dispatch board owns live assignments.
Scope: R0-R4 in [PLAN](../../PLAN.md); other engines and hosted mode remain later.

## Read by role

| Need | Owner document |
| --- | --- |
| Dependency order and effort | [Work packages](work-packages.md) |
| Concurrent versus exclusive work | [Schedule and locks](schedule.md) |
| Model assignment and unchanged quality bar | [Model/quality policy](model-quality.md) |
| Context preloading and stale-input handling | [Context packet](context-packet.md) |
| Worker/reviewer/handoff instructions | [Worker](templates/worker.md), [reviewer](templates/reviewer.md), [handoff](templates/handoff.md) |

Product architecture remains in [HLD](../design/HLD.md), not this orchestration plan.
Code rules remain in [engineering](../engineering.md). Tests remain in
[verification](../verification.md); an agent cannot redefine them in its report.

## Concurrency and roles

Current environment: four active agent slots total, including the coordinator.
Normal maximum is one coordinator plus three workers. An Astra reviewer consumes
one of those three slots; it is not extra capacity. Recheck available tools/limits
at execution time. A model's large context window is not permission to load the
entire repository. No nested delegation by workers.

Coordinator: owns shared contracts/configuration, assignment, integration and
acceptance. Sol: normal implementer and substantive reviewer. Luna: constrained,
calibrated tasks. Astra: independent opinions on ambiguous/high-consequence
boundaries. Routing details are [here](model-quality.md).

## Effort and uncertainty

[Work packages](work-packages.md) total 54-89 task-hours of implementation, 5-11
active hours for named qualification packets, plus 12-25 for independent
review/integration/rework: 71-125 task-hours in all.
A task-hour means occupied execution time including scoped checks, excluding queue
and user-input waits; concurrent sessions add effort but overlap wall time.
These are uncalibrated planning ranges, not measured model speeds or a deadline.
Do not convert them into a bill or assume three workers produce a 3x speedup.

With contracts stable and three usable worker slots, an initial code/integration
capacity envelope is roughly 30-55 elapsed active hours; review and serial lanes
limit overlap. This is not a forecast of fully qualified R0-R4 completion. Replace
it with a dependency/critical-path estimate after calibration. Qualification
access, manual review, user decisions and tool outages extend calendar time.

Re-estimate after the first three representative packets: foundation, one lifecycle
behavior and one UI behavior. Record session/check time, first-pass acceptance,
review findings, rework and integration delay by model/task type. Adjust the next
wave; report scope reductions openly. A prototype does not settle full rewrite effort.

## Preconditions

Bootstrap exception: coordinator alone starts W00 using a manually checked, narrow
packet with inherited instructions and known scope; the missing preflight tool
cannot validate itself before it exists. After W00, W01 freezes schemas. Only then
start normal builders with a reviewed baseline, implemented gates and tested packets.
PLAN/docs are committed in the design snapshot. No packet is ready until
its read inputs are actually materialized and hash-checked in the target worktree.

Unresolved asset-distribution decisions block only
their dependent packets. They must not be invented by a worker. Coordinator may
advance independent contracts/fake-engine work without pretending those choices
are settled. Existing approval/cost/network rules continue to apply.

## Definition of done

A package is accepted only after independent review, scoped verification and
integration checks on its exact source. R0-R4 completion means the current feature
inventory and requested namespace/settings additions work through the new stack,
with no placeholder success path and no old-server dependency. Release-qualified
is a separate evidence status, not implied by code written or by an Astra opinion.

Keep a small mutable dispatch board outside product documentation: task, state,
base/result SHA, packet hash, assigned model, file ownership, locks and blocker.
Link compact reports; do not append full agent conversations or logs to this plan.
