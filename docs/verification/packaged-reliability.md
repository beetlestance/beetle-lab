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

The next hosted outcome localized both failures to the authenticated agent probe.
Compose declares root for the entrypoint, then permanently drops the service to
1000:1000. A plain `docker exec` inherits the declaration, not PID1's dropped UID.
On Linux, root without DAC capabilities cannot read the service's private credential.
The probe now explicitly uses the independently asserted service identity.

A real private-tmpfs Linux check reproduced default-probe refusal and authenticated
HTTP 200 with UID1000 and zero effective capabilities. It used only synthetic data;
its container was removed. No credential mode, capability or authentication changed.
The corrected normal harness then passed the unchanged scanned de4f908 ARM64 stack
in 47.530 s: eight artifacts, real k6/export, restart persistence and verified cleanup.
Hosted confirmation remains separate; this does not resolve the original guard stop.

With the probe corrected, both hosted architectures passed ordinary k6 execution,
artifact checks and offline export. Their next failure was a settings GET after
the second Compose startup. That boundary now uses the existing bounded GET
readiness owner before asserting the exact saved settings. No mutation is retried
and no session is replaced. Authorization/scope refusal, invalid requests, caller
cancellation and permanent errors still fail immediately; transient reads retain
the 100-call/45-second cap, share one cancellation signal and reject late success.
Public failures may include only a validated numeric HTTP status. Hosted proof of
this correction is pending; no previous failure or transport-latency claim is erased.

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

## Publisher/guard composition

A separate deterministic reproduction held the result publisher's two-name hard
link window open for a real output scan. Publication succeeded, but the scanner
correctly rejected the alias as custody failure. This does not explain the original
prepare-phase stop, which left no final result file.

Result publication now exclusively creates one final pathname, with bounded writes,
file fsync/close, named identity checks and parent fsync/close before success. The
filename may appear early; successful publication and the reported control seal
are completion authority. Failed/partial output remains charged and unconfirmed.
The scanner's single-link rule is unchanged. Composed fault and native confirmation
remain required before release; source-level correction alone is not qualification.
