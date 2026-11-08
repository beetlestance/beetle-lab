# One-shot native process boundary

Public entry: `createNativeProcess` in `index.ts`; trusted local composition only.
Construction snapshots a managed runtime AttemptBudget and fixed installed paths,
transport limits, sink and clock callbacks. `run` returns the same one-shot promise;
no failed/late/unknown invocation is retried. `close` fences future launch. Callback
returns recheck cancellation; issued work is published before reentrant hooks.

Before launch, canonical absolute non-symlink regular files are checked: executable,
<=16-byte empty JSON config, <=64MiB owned `suite.js`, private output directory,
and absent `beetle-evidence.json`. The root/image and output must be trusted against
concurrent same-UID replacement. No staged secret or summary content is read.
Launch is detached POSIX, shell:false, fixed argv and three fixed environment keys.
Production target is Linux; Darwin is used only by owned compatibility fixtures.

The admitted absolute wall deadline consumes earlier setup time. A nonextending
local monotonic ceiling and repeated final clock samples fail closed on expiry,
rollback, invalid values or callback errors. Cancellation/stream failure interrupts
delivery independently, sends TERM once, then KILL after the first fixed 5 seconds.
Only the PID from this child's spawn notification authorizes group signals.
Confirmed group absence retires its PID forever; exit/stdio closure remain separate. The trusted
native workload must keep descendants in its group; escaped sessions are outside
this POSIX group boundary. Container init/subreaper and OS cleanup need qualification.

Metrics use one <=64KiB read and one awaited sink call, without an internal queue.
The pipe retains its Node high-water buffer; excessive injected buffering fails at
8MiB. The required trusted sink must project/schema-check raw metric bytes, retain
bounded data and honor its AbortSignal/deadline. Node pipe backpressure does not
bound k6's Go SampleBuffer: native hard RAM containment/OOM qualification is needed.
`metricBytes` counts admitted reads; stderr counts observed bytes and is discarded.
Transport quota is distinct from persisted output quota; limits make evidence partial.

Run waiting is bounded through termination/drain; unknown observations retain late
spawn cleanup handlers. `quiescent:false` means issued profile/sink/child work is
unconfirmed. Idempotent close awaits that original work and can remain pending for
an uncooperative sink/kernel/unknown child. Late completion never upgrades evidence.
Exit codes/signals are observations, never pass/fail/OOM evidence. No result seal,
reservation release, restart replay or guard capability qualification lives here.

Check: `NODE_OPTIONS=--max-old-space-size=1024 node node_modules/vitest/vitest.mjs run engines/k6/test/native-process --maxWorkers=2`.
