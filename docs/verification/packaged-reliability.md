# Packaged reliability investigation

Base: 6d0c4e9. These are failure-localization results, not release acceptance.

## Hosted startup

Both native architecture jobs built their six candidate images but failed during
startup. Cleanup succeeded on both. The public outcome intentionally excluded raw
exceptions; its original phase was too coarse to identify the failing operation.

The harness now distinguishes Compose startup, local session, agent readiness and
control-reserve inspection. Public diagnosis permits fixed failure codes and a
whitelisted source filename plus bounded numeric line/column. It never includes
exception text, full stack paths, assertion values or session/credential fields.
Real assertion/token and private-path canaries exercise this boundary. Raw details
remain in private local evidence. More precise phases do not fix a startup failure.

## Public read timeout

An unmodified de4f908 run failed a public run read, although durable metadata later
showed a finished/passed k6 run. A full-flow diagnostic reproduced a request abort
at about 2001 ms against the existing 2000 ms client bound. That agent recorded six
known guard scans and no guard stop. Caps and enforcement were unchanged.

Two subsequent full diagnostic flows passed with verified cleanup. Proxy timing
was enabled using fixed fields, and bounded request timings and cgroup statistics
were retained privately. Instrumentation-only agent/proxy mounts mean those runs
do not count as unmodified candidate qualification. A passing request or flow does
not establish the cause of the earlier timeout. No timeout was extended.

## Original guard stop

The 9c326f4 `artifact_incomplete` stop remains unexplained. Six earlier ordinary
diagnostic runs recorded 62 known scans, no stop, and verified cleanup. The failed
public-read diagnostic likewise did not reproduce the guard stop. Do not merge
these distinct failures into an unsupported resource-limit explanation.

Next: use the closed hosted failure location to resolve startup, capture the
failing read's proxy/backend timing, and obtain the actual guard stop branch before
making an enforcement change. Preserve [release blockers](qualification-blockers.md).
