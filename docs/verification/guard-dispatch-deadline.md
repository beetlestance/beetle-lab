# Deferred output scan deadline

The guard captures a sample deadline before entering its owned deferred scanner.
A valid deadline can expire before dispatch begins. `scanBudget` previously
classified this as `invalid_input`; the guard immediately maps that refusal to
`artifact_incomplete`, even while its last known sample remains within the TTL.

The scanner now reports `deadline` for an expired finite nonnegative timestamp.
It performs no native traversal and never refreshes last-known time. The existing
freshness watchdog still stops at the same TTL. Malformed/accessor/negative and
excessive future deadlines remain invalid. No resource cap, sample allowance,
watchdog deadline or custody predicate changed.

A composed real-scanner regression establishes a known sample, holds the next
original beyond its sample deadline but within the freshness TTL, and observes an
immediate stop on the old code. With the correction, no traversal or immediate
stop occurs, the last-known timestamp stays unchanged, and the same TTL stops the
watch. The regression and malformed-input cases pass with existing guard/staging
checks; types, lint and architecture checks pass.

This establishes a reproducible stop mechanism, not the missing historical 9c
trace. The original retained journal has no exact scanner/reader stop branch.
A new private ordinary run of those six images recorded eleven known scans
(maximum 85 ms), eight successful control reads and verified cleanup. It did not
reproduce the historical failure. Instrumented mounts are diagnostic evidence.

The temporary-build-directory permissions hypothesis was ruled out: both original
container entrypoints set umask077. Direct builder behavior under the host's
umask does not establish the shipped failure; that experimental edit was discarded.
A private native red/green pair kept the original six 9c images and shipped caps.
Both runs delayed only the second sample by 1100 ms against the existing 1000 ms
sample allowance and 2000 ms TTL. Old classification produced `invalid_input`
and an immediate guard cancellation at a last-known age of 1492 ms. A subsequent
control-reader `missing` was downstream of that stop. With only the classification
corrected, the same delayed sample was a `deadline`, later samples recovered and
the real k6 run passed. Both fixtures verified cleanup. These injected runs are
causal fault evidence. Normal changed-source native qualification then passed
on both Linux architectures in [CI run 43684837244](https://github.com/beetlestance/beetle-lab/actions/runs/43684837244),
revision `72243a87`: real k6/artifacts/export, repeat-up/restart, scans and isolated
archive restoration. All six unit shards and both aggregate gates passed too.
Actual Chromium acceptance against the public immutable `72243a87` images then
passed all twelve functional phases in 206.6 seconds, with cleanup verified.
Its six recorded image IDs match the planned ARM64 root/child/config identities.
The same public images passed fresh anonymous pulls and normal native execution
on AMD64 and ARM64 in delivery run `43688603429`. The first AMD64 delivery attempt
failed without a retained phase; its cause remains unknown. The retry added safe
harness diagnostics only and did not change image bytes, caps or assertions.
