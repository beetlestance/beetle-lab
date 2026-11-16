# Schema29 candidate fixture corrections

Candidate source501a8b74 CI43867870066 did not pass: native AMD active recovery
missed its short workload window, and five test shards exposed stale fixtures plus
one timing assumption. The ARM native image job passed. Failed evidence remains
retained; these local corrections do not relabel that CI run as successful.

## Corrections

Historical projection helpers stopped at27 even after production added28/29.
The test-only27 projection constructs its reference from genuine predecessor
migrations, verifies the exact current shipped schema and refuses retired workspace
identities before mutation. It restores only known changed schema objects and
removes the additive inactive flag within one transaction; exact target graph and
foreign keys are checked. No production migration, guard or rollback support changes.

Namespace-deletion identities, paid-retention counters and committed cleanup ACKs
are checked before the relevant projection chain can change schema. Refusal cases
compare the whole graph, rows and version. An exact synthetic27→29 round trip
preserves original data, receipts and charge. Unknown schema cannot be projected.

Older migration assertions now expect every original field plus the explicit
`retired:0` additive default; they do not ignore the workspace table. The HTTP
namespace test expects organisation409 after workspace retirement because retained
safety records still protect that parent. It also verifies the organisation remains
readable and the exact workspace deletion response replays.

A controller failure/custody test waits for the actual collector-start signal
instead of sleeping25ms. Pending I/O, no-close-before-quiescence, busy concurrent
calls and retained-charge assertions remain unchanged.

The backup-copy fixture previously declared schema27 on a two-table synthetic
file. It now creates current metadata through the real compiled worker and saves a
valid private session through its actual owner. The bounded copy test uses4MiB for
that actual schema, removes credentials only in the copy, preserves source session
JSON and retains the independent synthetic-table oracle. Product budgets are unchanged.

## Verification boundary

Scoped original/corrected checks cover14distinct files and79cases through retained
passes and affected reruns. In the final shared-projection lane, ten files/40cases
passed; four affected files/15cases passed after the preflight/backup corrections.
The failed initial projection attempted ALTER while a dependent view was absent;
restoring the verified predecessor views before ALTER fixed that ordering. An
initial private-schema import violated architecture policy and was replaced with
the existing allowed worker fixture. Both failures remain recorded.

Independent review accepted preservation and custody, subject to final static
checks. Final types/lint/architecture/documentation checks passed. The final
changed-projection lane passed nine files/34cases in21.77s; the current-schema
backup file passed six cases in the final affected lane. Full candidate CI and the [longer active-recovery fixture](active-recovery.md)
remain required. No user database or installation was modified.
