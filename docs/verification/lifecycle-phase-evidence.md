# Restart evidence by lifecycle boundary

V03 requires recovery of the exact execution/generation and its reservations.
These cases map the durable control boundaries; wrapper prepare/execute/finalize
are observations within the same owned execution, not permission to launch anew.
Source CI43793313636 and [integrated evidence](integrated-acceptance.md) execute the
unchanged agent/engine cases below. The added unfinished-staging reopen cases
passed locally at Node24.22.3:5cases in one file, including both new boundaries. New schema29 candidate qualification remains
open. This table is evidence reconciliation, not a new test run or a native crash
at every line of code.

| Boundary at loss/reopen | Exact case owner and required observation |
| --- | --- |
| Queued accepted intent | [Run intake](../../app/test/bootstrap/run-intake.test.ts): lost successful enqueue across restart retains one persisted execution intent. |
| Claimed, before delivery | [Delivery HTTP](../../app/test/bootstrap/delivery-http.test.ts): reopen claim before PUT, scoped404, send same original once. |
| Accepted offer / lost reply | Same HTTP file: lost PUT response after worker restart/profile drift does not issue another PUT. |
| Admitted, before create | [Supervisor recovery](../../agent/test/supervisor/recovery.test.ts): actual Journal reopen before create claim permits one launch. [Staging](../../agent/test/staging/prepare.test.ts) requires exact charged reservation before first write; no recovered profile substitution. |
| Unfinished staging namespace | [Actual preparing/prepared reopen](../../agent/test/staging-namespace/partial.test.ts): real partial files and durable task facts survive Journal close/reopen; recreated Stager refuses adoption, invokes no providers, retains exact charge and bytes, and issues no Docker mutation. Safe quarantine, not automatic completion. |
| Create/start outcome unknown | [Launch](../../agent/test/supervisor/launch.test.ts): actor replacement after lost create/start inspects the original, never replays target load. [Cold unknown inspection](../../agent/test/installation/absence-recovery.test.ts) retains running/unknown/wrong-ID/restarting debt. |
| Owned running execution | [Supervisor reopen](../../agent/test/supervisor/recovery.test.ts) restores the original without dispatch. [Both-native active recovery](active-recovery.md) kills/reopens backend and agent during actual work; physical counters detect duplicate load. |
| Cancellation pending / grace | Supervisor recovery preserves durable grace across actual Journal close/reopen. [Cancellation HTTP](../../app/test/bootstrap/cancellation-http.test.ts) recovers lost ACK across restart without fabricating execution. |
| Execution ended, output/source pending | [Controller recovery](../../agent/test/controller/source-recovery.test.ts): recreated controller cannot fail-release successful collection awaiting source commit; reopened pending custody preserves original evidence and charge. |
| Source committed / delivery unacknowledged | [Installation recovery](../../agent/test/installation/source-recovery.test.ts): durable source release precedes catalogue/Offer/staging/native recovery, including withheld COMMIT reply and reopen. |
| Backend receiving / publishing | [Transfer recovery](../../app/test/output-transfer/recovery.test.ts): held mutations reconcile the original writer; publishing resumes without requesting chunks or preparing again. |
| Terminal projection committed / reply lost | [Compiled worker finalization](../../app/test/output-finalization/worker.test.ts): reopen recovers exactly one credit and immutable terminal projection. |
| Runtime removal / reply lost | [Association recovery](../../agent/test/runtime-association/recovery.test.ts): exact observed original is durably associated before DELETE; cold recovery handles lost deletion reply. |
| Deletion / cleanup / settlement | [Actual cleanup crash](cleanup-agent-crash.md), [composed recovery](cleanup-composed.md), [native settlement](native-settlement.md): no invented physical completion or premature refund. |
| Maintenance / whole installation cold | [Packaged cold recovery](packaged-cold-recovery.md): default UID, fresh history-only restore and exact source-bound resume; [source archive](source-cold-history.md) adds foreign-resume refusal and one older-reader pair. |

Unknown original outcomes remain charged. Late callbacks do not grant replacement
execution or erase uncertainty. Native execution validates the unchanged Docker
boundary; deterministic held originals and durable reopen cases establish the
specific loss ordering. New schema/read-only compatibility is not inferred from
an older archive, and mutable history restore remains unsupported.
